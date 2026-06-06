import { Ionicons } from '@expo/vector-icons'
import {
  type AudioRecorder,
  type AudioStreamBuffer,
  type RecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
  useAudioStream,
} from 'expo-audio'
import * as FileSystem from 'expo-file-system/legacy'
import * as Haptics from 'expo-haptics'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'

import {
  type MobileVoiceSynthesisResult,
  useMobileRuntime,
} from '../../src/api/mobile-runtime-context'
import { Screen } from '../../src/components/Screen'
import { useT } from '../../src/i18n'
import {
  buildPcmProbeLogLine,
  buildSileroShadowLogLine,
  createInitialPcmProbeLogState,
  createInitialSileroShadowFrameState,
  extractSileroShadowFrames,
  resolveNeuralVadPcmProbeEnabled,
  resolveNeuralVadShadowEnabled,
} from '../../src/lib/neural-vad-pcm-probe'
import {
  applyNeuralVoiceVadProbabilitySample,
  assessNeuralVoiceSegmentQuality,
  buildNeuralVoiceVadDebugLine,
  createInitialNeuralVoiceSegmentQualityState,
  createInitialNeuralVoiceVadState,
  type NeuralVoiceSegmentQualityState,
  type NeuralVoiceVadState,
  recordNeuralVoiceSegmentQualitySample,
  shouldUseVolumeVadFallback,
} from '../../src/lib/neural-voice-vad'
import {
  listPendingTalkbackReplies,
  reduceTalkbackState,
  runTalkbackInput,
  shouldFinishTalkbackReplyRound,
  type TalkbackState,
} from '../../src/lib/push-to-talk'
import {
  createSileroVadShadowScorer,
  type SileroVadShadowScorer,
} from '../../src/lib/silero-vad-shadow'
import {
  getTalkStateVisual,
  resolveConnectionCue,
  resolveTalkStateCue,
  type TalkAudioCue,
  type TalkCue,
  type TalkHapticCue,
  type TalkStateVisual,
} from '../../src/lib/talk-ui-cues'
import {
  applyVadMeteringSample,
  createInitialVoiceVadState,
  DEFAULT_VAD_CONFIG,
  type VoiceVadState,
} from '../../src/lib/voice-vad'
import { colors, radius, spacing } from '../../src/theme'

type TalkInputMode = 'push_to_talk' | 'continuous'

const TALKBACK_REPLY_IDLE_TIMEOUT_MS = 3500
const BARGE_IN_VAD_CONFIG = {
  ...DEFAULT_VAD_CONFIG,
  confirmedSpeechMarginDb: 25,
  speechMarginDb: 25,
  startupSpeechThresholdDb: -26,
}
const BARGE_IN_SPEECH_START_SAMPLE_COUNT = 3
const BARGE_IN_METERING_FRESHNESS_MS = 500
const NEURAL_VAD_DEAD_PCM_RMS_THRESHOLD = 0.0001
const TALK_HAPTICS_ENABLED = process.env.EXPO_PUBLIC_TALK_HAPTICS_ENABLED !== '0'
const TALK_AUDIO_CUES_ENABLED = process.env.EXPO_PUBLIC_TALK_AUDIO_CUES_ENABLED !== '0'

const isTalkbackBargeInAndroidEnabled = () =>
  process.env.EXPO_PUBLIC_TALKBACK_BARGE_IN_ENABLED !== '0' && Platform.OS === 'android'

const isNeuralVadPcmProbeEnabled = () => resolveNeuralVadPcmProbeEnabled(process.env)
const isNeuralVadShadowEnabled = () => resolveNeuralVadShadowEnabled(process.env)

const isVoiceSynthesisResult = (value: unknown): value is MobileVoiceSynthesisResult =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as MobileVoiceSynthesisResult).audio === 'string' &&
  typeof (value as MobileVoiceSynthesisResult).mime === 'string'

const latestOrchestratorReplyId = (
  messages: Array<{ created_at: number; id: string; message_type: string }>
) =>
  messages
    .filter((message) => message.message_type === 'orch_reply')
    .sort((a, b) => a.created_at - b.created_at)
    .at(-1)?.id ?? null

const snapshotOrchestratorReplyIds = (messages: Array<{ id: string; message_type: string }>) =>
  new Set(messages.filter((message) => message.message_type === 'orch_reply').map((m) => m.id))

const isRecorderPrepared = (status: RecorderState) => status.canRecord || status.isRecording

const encodeBase64Bytes = (bytes: Uint8Array) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0
    const second = bytes[index + 1] ?? 0
    const third = bytes[index + 2] ?? 0
    const chunk = (first << 16) | (second << 8) | third
    output += alphabet[(chunk >> 18) & 63]
    output += alphabet[(chunk >> 12) & 63]
    output += index + 1 < bytes.length ? alphabet[(chunk >> 6) & 63] : '='
    output += index + 2 < bytes.length ? alphabet[chunk & 63] : '='
  }
  return output
}

const writeAscii = (bytes: Uint8Array, offset: number, text: string) => {
  for (let index = 0; index < text.length; index += 1) {
    bytes[offset + index] = text.charCodeAt(index)
  }
}

const writeUint16 = (view: DataView, offset: number, value: number) =>
  view.setUint16(offset, value, true)

const writeUint32 = (view: DataView, offset: number, value: number) =>
  view.setUint32(offset, value, true)

const buildToneCueUri = (startFrequency: number, endFrequency: number, durationMs: number) => {
  const sampleRate = 8000
  const samples = Math.max(1, Math.floor((sampleRate * durationMs) / 1000))
  const dataSize = samples * 2
  const bytes = new Uint8Array(44 + dataSize)
  const view = new DataView(bytes.buffer)
  writeAscii(bytes, 0, 'RIFF')
  writeUint32(view, 4, 36 + dataSize)
  writeAscii(bytes, 8, 'WAVE')
  writeAscii(bytes, 12, 'fmt ')
  writeUint32(view, 16, 16)
  writeUint16(view, 20, 1)
  writeUint16(view, 22, 1)
  writeUint32(view, 24, sampleRate)
  writeUint32(view, 28, sampleRate * 2)
  writeUint16(view, 32, 2)
  writeUint16(view, 34, 16)
  writeAscii(bytes, 36, 'data')
  writeUint32(view, 40, dataSize)
  for (let index = 0; index < samples; index += 1) {
    const progress = samples === 1 ? 0 : index / (samples - 1)
    const frequency = startFrequency + (endFrequency - startFrequency) * progress
    const envelope = Math.sin(Math.PI * progress)
    const sample = Math.round(
      Math.sin(2 * Math.PI * frequency * (index / sampleRate)) * 0.28 * envelope * 32767
    )
    view.setInt16(44 + index * 2, sample, true)
  }
  return `data:audio/wav;base64,${encodeBase64Bytes(bytes)}`
}

const TALK_CUE_AUDIO_URIS: Record<TalkAudioCue, string> = {
  error: buildToneCueUri(180, 180, 220),
  exit: buildToneCueUri(520, 360, 150),
  listen: buildToneCueUri(720, 1040, 180),
  network: buildToneCueUri(360, 540, 160),
  process: buildToneCueUri(440, 260, 180),
}

const playHapticCue = async (cue: TalkHapticCue) => {
  if (!TALK_HAPTICS_ENABLED) return
  if (cue === 'warning') {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    return
  }
  if (cue === 'medium') {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    return
  }
  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  if (cue === 'double') {
    setTimeout(
      () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
      120
    )
  }
}

// Convert a #RRGGBB hex to an rgba() string for the animated state rings/halo.
const hexToRgba = (hex: string, alpha: number) => {
  const value = hex.replace('#', '')
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// One expanding "breathing" ring. Pure transform/opacity animation on the UI
// thread (reanimated) so it stays smooth on-device without touching JS per frame.
function PulseRing({ color, delay, size }: { color: string; delay: number; size: number }) {
  const progress = useSharedValue(0)
  useEffect(() => {
    progress.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2100 }), -1, false))
    return () => cancelAnimation(progress)
  }, [delay, progress])
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.5 * (1 - progress.value),
    transform: [{ scale: 0.92 + progress.value * 0.55 }],
  }))
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.orbRing, { borderColor: color, height: size, width: size }, animatedStyle]}
    />
  )
}

// Rotating arc shown while processing.
function SpinArc({ color, size }: { color: string; size: number }) {
  const rotation = useSharedValue(0)
  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 1000, easing: Easing.linear }),
      -1,
      false
    )
    return () => cancelAnimation(rotation)
  }, [rotation])
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }))
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.orbSpin,
        { borderRightColor: color, borderTopColor: color, height: size, width: size },
        animatedStyle,
      ]}
    />
  )
}

// One bar of the live waveform / equalizer (listening + speaking).
function WaveBar({ color, delay, duration }: { color: string; delay: number; duration: number }) {
  const level = useSharedValue(0)
  useEffect(() => {
    level.value = withDelay(delay, withRepeat(withTiming(1, { duration }), -1, true))
    return () => cancelAnimation(level)
  }, [delay, duration, level])
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: 0.28 + level.value * 0.72 }],
  }))
  return <Animated.View style={[styles.waveBar, { backgroundColor: color }, animatedStyle]} />
}

const WAVE_BARS = [
  { delay: 0, duration: 720 },
  { delay: 120, duration: 900 },
  { delay: 240, duration: 640 },
  { delay: 80, duration: 820 },
  { delay: 320, duration: 700 },
  { delay: 160, duration: 880 },
  { delay: 40, duration: 760 },
]

// Premium animated orb: state-colored halo + per-state motion (breathing rings /
// spinning arc / sonar) + live waveform + a center glyph. Decoration only — it
// renders inside the existing Pressable and never affects the touch/logic layer.
function TalkOrb({
  accent,
  immersive,
  kind,
  children,
}: {
  accent: string
  immersive: boolean
  kind: TalkStateVisual['kind']
  children: ReactNode
}) {
  const orbSize = immersive ? 208 : 168
  const showWave = kind === 'listening' || kind === 'speaking'
  return (
    <View style={[styles.orb, { height: orbSize, width: orbSize }]}>
      <View
        pointerEvents="none"
        style={[styles.orbHalo, { backgroundColor: hexToRgba(accent, 0.18) }]}
      />
      {kind === 'listening' ? (
        <>
          <PulseRing color={hexToRgba(accent, 0.55)} delay={0} size={orbSize} />
          <PulseRing color={hexToRgba(accent, 0.45)} delay={700} size={orbSize} />
          <PulseRing color={hexToRgba(accent, 0.35)} delay={1400} size={orbSize} />
        </>
      ) : null}
      {kind === 'processing' ? <SpinArc color={accent} size={orbSize - 12} /> : null}
      {kind === 'speaking' ? (
        <>
          <PulseRing color={hexToRgba(accent, 0.5)} delay={0} size={orbSize} />
          <PulseRing color={hexToRgba(accent, 0.32)} delay={850} size={orbSize} />
        </>
      ) : null}
      <View
        pointerEvents="none"
        style={[styles.orbGlyph, { backgroundColor: accent, shadowColor: accent }]}
      >
        {children}
      </View>
      {showWave ? (
        <View pointerEvents="none" style={styles.waveRow}>
          {WAVE_BARS.map((bar, index) => (
            <WaveBar
              color={accent}
              delay={bar.delay}
              duration={bar.duration}
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static decorative bar list
              key={index}
            />
          ))}
        </View>
      ) : null}
    </View>
  )
}

function NeuralVadPcmProbe({
  active,
  onScore,
  pcmLogEnabled,
  shadowEnabled,
}: {
  active: boolean
  onScore?: (result: {
    durationMs: number
    frameIndex: number
    probability: number
    rms: number
    sampleRate: number
    timestampMs: number
  }) => void
  pcmLogEnabled: boolean
  shadowEnabled: boolean
}) {
  const logStateRef = useRef(createInitialPcmProbeLogState())
  const sileroFrameStateRef = useRef(createInitialSileroShadowFrameState())
  const sileroScorerRef = useRef<SileroVadShadowScorer | null>(null)
  const sileroScoreQueueRef = useRef<Promise<void>>(Promise.resolve())
  const sileroErrorLoggedRef = useRef(false)
  const handleBuffer = useCallback(
    (buffer: AudioStreamBuffer) => {
      if (pcmLogEnabled) {
        const result = buildPcmProbeLogLine(logStateRef.current, buffer, {
          encoding: 'int16',
          nowMs: Date.now(),
        })
        logStateRef.current = result.state
        if (result.line) console.log(result.line)
      }

      if (!shadowEnabled) return
      const extracted = extractSileroShadowFrames(sileroFrameStateRef.current, buffer.data)
      sileroFrameStateRef.current = extracted.state
      if (extracted.frames.length === 0) return
      sileroScorerRef.current ??= createSileroVadShadowScorer()
      const scorer = sileroScorerRef.current
      sileroScoreQueueRef.current = sileroScoreQueueRef.current
        .then(async () => {
          for (const frame of extracted.frames) {
            const probability = await scorer.score(frame)
            if (probability !== null) {
              console.log(
                buildSileroShadowLogLine({
                  frameIndex: frame.index,
                  probability,
                  rms: frame.rms,
                  sampleRate: buffer.sampleRate,
                })
              )
              onScore?.({
                durationMs: 32,
                frameIndex: frame.index,
                probability,
                rms: frame.rms,
                sampleRate: buffer.sampleRate,
                timestampMs: Date.now(),
              })
            }
          }
        })
        .catch((error: unknown) => {
          if (!sileroErrorLoggedRef.current) {
            sileroErrorLoggedRef.current = true
            console.log(
              `[SILERODBG] score_failed ${error instanceof Error ? error.message : String(error)}`
            )
          }
        })
    },
    [onScore, pcmLogEnabled, shadowEnabled]
  )
  const { stream } = useAudioStream({
    channels: 1,
    encoding: 'int16',
    onBuffer: handleBuffer,
    sampleRate: 16_000,
  })

  useEffect(() => {
    if (!active) {
      stream.stop()
      return
    }
    let cancelled = false
    void stream.start().catch((error: unknown) => {
      if (!cancelled)
        console.log(
          `[PCMDBG] stream_start_failed ${error instanceof Error ? error.message : String(error)}`
        )
    })
    return () => {
      cancelled = true
      stream.stop()
    }
  }, [active, stream])

  return null
}

export default function TalkTab() {
  const {
    chatMessages,
    sendPromptToOrchestratorWithOutcome,
    state,
    synthesizeVoice,
    synthesizeVoiceStream,
    transcribeVoice,
  } = useMobileRuntime()
  const t = useT()
  const [talkState, setTalkState] = useState<TalkbackState>('idle')
  // User-ratified default (2026-06-06): driving hands-free defaults to continuous.
  const [inputMode, setInputMode] = useState<TalkInputMode>('continuous')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [continuousRunnerTick, setContinuousRunnerTick] = useState(0)
  const [talkbackQueueTick, setTalkbackQueueTick] = useState(0)
  const connected = state === 'connected'
  const neuralVadPcmProbeEnabled = isNeuralVadPcmProbeEnabled()
  const neuralVadShadowEnabled = isNeuralVadShadowEnabled()
  const recordingOptions = useMemo(
    () => ({
      ...RecordingPresets.HIGH_QUALITY,
      android: {
        ...RecordingPresets.HIGH_QUALITY.android,
        ...(isTalkbackBargeInAndroidEnabled()
          ? { audioSource: 'voice_communication' as const }
          : {}),
      },
      isMeteringEnabled: true,
    }),
    []
  )
  const recorder = useAudioRecorder(recordingOptions)
  const recorderState = useAudioRecorderState(recorder, 200)
  const player = useAudioPlayer(null, { updateInterval: 100 })
  const cuePlayer = useAudioPlayer(null, { updateInterval: 50 })
  const playerStatus = useAudioPlayerStatus(player)
  const talkStateRef = useRef<TalkbackState>('idle')
  const previousCueTalkStateRef = useRef<TalkbackState>('idle')
  const previousConnectedRef = useRef(connected)
  const inputModeRef = useRef<TalkInputMode>('continuous')
  const continuousEnabledRef = useRef(false)
  const processingSegmentRef = useRef(false)
  const vadStateRef = useRef<VoiceVadState>(createInitialVoiceVadState())
  const neuralVadStateRef = useRef<NeuralVoiceVadState>(createInitialNeuralVoiceVadState())
  const neuralVoiceSegmentQualityRef = useRef<NeuralVoiceSegmentQualityState>(
    createInitialNeuralVoiceSegmentQualityState()
  )
  const latestUsableNeuralSampleAtMsRef = useRef<number | null>(null)
  const latestMeteringRef = useRef<number | null>(null)
  const latestMeteringAtMsRef = useRef<number | null>(null)
  const bargeInSpeechStartSampleCountRef = useRef(0)
  const recorderRef = useRef<AudioRecorder>(recorder)
  const recordingActiveRef = useRef(false)
  const activePlaybackReplyIdRef = useRef<string | null>(null)
  const chatMessagesRef = useRef(chatMessages)
  const lastSpokenReplyIdRef = useRef<string | null>(null)
  const spokenReplyIdsRef = useRef<Set<string>>(new Set())
  const promptBaselineReplyIdsRef = useRef<Set<string> | null>(null)
  const talkbackBaselinePendingRef = useRef(false)
  const talkbackPlaybackEnabledRef = useRef(false)
  const initializedReplyCursorRef = useRef(false)
  const inFlightReplyIdRef = useRef<string | null>(null)
  const lastPlaybackFinishedAtMsRef = useRef<number | null>(null)
  const replyQueueGenerationRef = useRef(0)
  const replyRoundFinishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  chatMessagesRef.current = chatMessages
  inputModeRef.current = inputMode
  recorderRef.current = recorder

  const dispatchTalkEvent = useCallback((event: Parameters<typeof reduceTalkbackState>[1]) => {
    talkStateRef.current = reduceTalkbackState(talkStateRef.current, event)
    setTalkState((current) => {
      const next = reduceTalkbackState(current, event)
      talkStateRef.current = next
      return next
    })
    if (event.type === 'failed') setError(event.message)
    if (
      event.type === 'reset' ||
      event.type === 'recordStart' ||
      event.type === 'continuousStart'
    ) {
      setError(null)
    }
  }, [])

  const playTalkCue = useCallback(
    (cue: TalkCue | null) => {
      if (!cue) return
      if (cue.haptic) void playHapticCue(cue.haptic).catch(() => {})
      const recordingUnsafe =
        talkStateRef.current === 'listening' ||
        talkStateRef.current === 'capturing' ||
        talkStateRef.current === 'recording' ||
        recordingActiveRef.current ||
        processingSegmentRef.current
      if (cue.audio && TALK_AUDIO_CUES_ENABLED && !recordingUnsafe) {
        try {
          cuePlayer.pause()
          cuePlayer.replace({ uri: TALK_CUE_AUDIO_URIS[cue.audio] })
          cuePlayer.play()
        } catch {
          // Cue playback is best-effort; it must never interrupt talkback.
        }
      }
    },
    [cuePlayer]
  )

  useEffect(() => {
    const previous = previousCueTalkStateRef.current
    previousCueTalkStateRef.current = talkState
    playTalkCue(resolveTalkStateCue(previous, talkState))
  }, [playTalkCue, talkState])

  useEffect(() => {
    const previous = previousConnectedRef.current
    previousConnectedRef.current = connected
    playTalkCue(resolveConnectionCue(previous, connected))
  }, [connected, playTalkCue])

  const clearReplyRoundFinishTimer = useCallback(() => {
    if (replyRoundFinishTimerRef.current) clearTimeout(replyRoundFinishTimerRef.current)
    replyRoundFinishTimerRef.current = null
  }, [])

  const resetReplyQueueForPrompt = useCallback(() => {
    replyQueueGenerationRef.current += 1
    bargeInSpeechStartSampleCountRef.current = 0
    clearReplyRoundFinishTimer()
    activePlaybackReplyIdRef.current = null
    inFlightReplyIdRef.current = null
    lastPlaybackFinishedAtMsRef.current = null
  }, [clearReplyRoundFinishTimer])

  const enableTalkbackPlayback = useCallback(() => {
    if (talkbackPlaybackEnabledRef.current) return
    const baseline = snapshotOrchestratorReplyIds(chatMessagesRef.current)
    promptBaselineReplyIdsRef.current = baseline
    talkbackBaselinePendingRef.current = baseline.size === 0
    talkbackPlaybackEnabledRef.current = true
  }, [])

  const finalizePendingTalkbackBaseline = useCallback(() => {
    if (!talkbackBaselinePendingRef.current) return
    promptBaselineReplyIdsRef.current = snapshotOrchestratorReplyIds(chatMessagesRef.current)
    talkbackBaselinePendingRef.current = false
  }, [])

  const isTalkbackPlaybackAllowed = useCallback(
    () => inputModeRef.current === 'push_to_talk' || continuousEnabledRef.current,
    []
  )

  const isBargeInListeningAllowed = useCallback(
    () =>
      isTalkbackBargeInAndroidEnabled() &&
      inputModeRef.current === 'continuous' &&
      continuousEnabledRef.current,
    []
  )

  const resetNeuralVadDecision = useCallback(() => {
    neuralVadStateRef.current = createInitialNeuralVoiceVadState()
    neuralVoiceSegmentQualityRef.current = createInitialNeuralVoiceSegmentQualityState()
    latestUsableNeuralSampleAtMsRef.current = null
  }, [])

  const isNeuralBargeInMeteringAllowed = useCallback((nowMs: number) => {
    const metering = latestMeteringRef.current
    const latestMeteringAtMs = latestMeteringAtMsRef.current
    if (
      metering === null ||
      latestMeteringAtMs === null ||
      nowMs - latestMeteringAtMs > BARGE_IN_METERING_FRESHNESS_MS
    ) {
      return false
    }
    const noiseFloorDb = vadStateRef.current.noiseFloorDb
    return (
      metering >= BARGE_IN_VAD_CONFIG.startupSpeechThresholdDb ||
      (typeof noiseFloorDb === 'number' &&
        metering >= noiseFloorDb + BARGE_IN_VAD_CONFIG.speechMarginDb)
    )
  }, [])

  useEffect(() => {
    if (!initializedReplyCursorRef.current) {
      lastSpokenReplyIdRef.current = latestOrchestratorReplyId(chatMessages)
      initializedReplyCursorRef.current = true
    }
  }, [chatMessages])

  useEffect(() => {
    return () => {
      replyQueueGenerationRef.current += 1
      clearReplyRoundFinishTimer()
      if (recordingActiveRef.current) void recorder.stop().catch(() => {})
      player.pause()
      cuePlayer.pause()
      player.remove()
      cuePlayer.remove()
    }
  }, [clearReplyRoundFinishTimer, cuePlayer, player, recorder])

  const startRecorderSegment = useCallback(
    async (targetRecorder: AudioRecorder = recorderRef.current) => {
      const permission = await requestRecordingPermissionsAsync()
      if (!permission.granted) {
        throw new Error(t('talk.error.microphoneDenied'))
      }
      player.pause()
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      })
      let status = targetRecorder.getStatus()
      if (status.isRecording) {
        if (recordingActiveRef.current) return
        await targetRecorder.stop()
        status = targetRecorder.getStatus()
      }
      if (isRecorderPrepared(status)) {
        targetRecorder.record()
        recordingActiveRef.current = true
        return
      }
      await targetRecorder.prepareToRecordAsync(recordingOptions)
      targetRecorder.record()
      recordingActiveRef.current = true
    },
    [player, recordingOptions, t]
  )

  const processRecordedSegment = useCallback(
    async (nextStateOnError: 'error' | 'listening' = 'error') => {
      if (processingSegmentRef.current) return
      const recorderForSegment = recorderRef.current
      processingSegmentRef.current = true
      try {
        const status = recorderForSegment.getStatus()
        if (isRecorderPrepared(status) || recordingActiveRef.current) {
          await recorderForSegment.stop()
        }
        recordingActiveRef.current = false
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        })
        if (nextStateOnError === 'listening' && !vadStateRef.current.hadRealSpeech) {
          resetReplyQueueForPrompt()
          dispatchTalkEvent({ type: 'reset' })
          if (continuousEnabledRef.current) dispatchTalkEvent({ type: 'continuousStart' })
          return
        }
        const qualityDecision = assessNeuralVoiceSegmentQuality(
          neuralVoiceSegmentQualityRef.current
        )
        console.log(
          `[VADQDBG] decision=${qualityDecision.shouldUpload ? 'upload' : 'drop'} reason=${qualityDecision.reason} avg=${qualityDecision.metrics.averageProbability.toFixed(3)} high_ratio=${qualityDecision.metrics.highProbabilityRatio.toFixed(3)} high_ms=${qualityDecision.metrics.highProbabilityDurationMs.toFixed(0)} active_ms=${qualityDecision.metrics.activeSpeechDurationMs.toFixed(0)} tail_ms=${qualityDecision.metrics.silenceTailDurationMs.toFixed(0)} total_ms=${qualityDecision.metrics.totalDurationMs.toFixed(0)} rms=${qualityDecision.metrics.averageRms.toFixed(3)} active_samples=${qualityDecision.metrics.activeSpeechSampleCount} tail_samples=${qualityDecision.metrics.silenceTailSampleCount} samples=${qualityDecision.metrics.sampleCount}`
        )
        neuralVoiceSegmentQualityRef.current = createInitialNeuralVoiceSegmentQualityState()
        if (!qualityDecision.shouldUpload) {
          resetReplyQueueForPrompt()
          dispatchTalkEvent({ type: 'reset' })
          if (continuousEnabledRef.current) dispatchTalkEvent({ type: 'continuousStart' })
          return
        }
        const uri = recorderForSegment.uri ?? recorderForSegment.getStatus().url
        if (!uri) throw new Error(t('talk.error.recordingMissing'))
        const audioBase64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        })
        finalizePendingTalkbackBaseline()
        resetReplyQueueForPrompt()
        const result = await runTalkbackInput({
          audioBase64,
          format: 'm4a',
          sendPromptToOrchestratorWithOutcome,
          transcribeVoice,
        })
        setTranscript(result.text)
        if (result.outcome === 'error') {
          throw new Error(t('talk.error.sendFailed'))
        }
        dispatchTalkEvent({ type: 'promptQueued' })
      } catch (sendError) {
        dispatchTalkEvent({
          message: sendError instanceof Error ? sendError.message : String(sendError),
          type: 'failed',
        })
      } finally {
        processingSegmentRef.current = false
        if (
          continuousEnabledRef.current &&
          talkStateRef.current === 'listening' &&
          !recordingActiveRef.current
        ) {
          setContinuousRunnerTick((current) => current + 1)
        }
      }
    },
    [
      dispatchTalkEvent,
      finalizePendingTalkbackBaseline,
      resetReplyQueueForPrompt,
      sendPromptToOrchestratorWithOutcome,
      t,
      transcribeVoice,
    ]
  )

  const handleNeuralVadScore = useCallback(
    (score: {
      durationMs: number
      frameIndex: number
      probability: number
      rms: number
      sampleRate: number
      timestampMs: number
    }) => {
      if (!continuousEnabledRef.current || !recordingActiveRef.current) return
      if (score.rms > NEURAL_VAD_DEAD_PCM_RMS_THRESHOLD) {
        latestUsableNeuralSampleAtMsRef.current = score.timestampMs
      }
      const mode =
        talkStateRef.current === 'speaking' && isBargeInListeningAllowed()
          ? 'barge_in'
          : 'continuous'
      const result = applyNeuralVoiceVadProbabilitySample(
        neuralVadStateRef.current,
        {
          durationMs: score.durationMs,
          probability: score.probability,
          timestampMs: score.timestampMs,
        },
        undefined,
        mode
      )
      const shouldRecordSegmentQuality =
        mode === 'continuous' &&
        (neuralVadStateRef.current.phase === 'capturing' || result.event === 'speechStart')
      if (shouldRecordSegmentQuality) {
        const previousState = neuralVadStateRef.current
        if (result.event === 'speechStart' && previousState.phase !== 'capturing') {
          neuralVoiceSegmentQualityRef.current = createInitialNeuralVoiceSegmentQualityState()
        }
        neuralVoiceSegmentQualityRef.current = recordNeuralVoiceSegmentQualitySample(
          neuralVoiceSegmentQualityRef.current,
          {
            durationMs: score.durationMs,
            probability: score.probability,
            rms: score.rms,
          }
        )
      }
      neuralVadStateRef.current = result.state
      if (result.state.hadRealSpeech) {
        vadStateRef.current = { ...vadStateRef.current, hadRealSpeech: true }
      }
      console.log(
        `${buildNeuralVoiceVadDebugLine({
          event: result.event,
          mode,
          probability: score.probability,
        })} frame=${score.frameIndex} rms=${score.rms.toFixed(3)} sr=${score.sampleRate}Hz`
      )

      if (result.event === 'speechStart') {
        const activePlaybackReplyId = activePlaybackReplyIdRef.current
        const isBargeInCandidate =
          mode === 'barge_in' &&
          talkStateRef.current === 'speaking' &&
          activePlaybackReplyId !== null
        if (isBargeInCandidate) {
          if (!isNeuralBargeInMeteringAllowed(score.timestampMs)) {
            console.log(
              `[BARGEDBG] mode=neural-barge_in voice_prob=${score.probability.toFixed(3)} ev=blocked_by_metering m=${latestMeteringRef.current}`
            )
            return
          }
          spokenReplyIdsRef.current.add(activePlaybackReplyId)
          replyQueueGenerationRef.current += 1
          clearReplyRoundFinishTimer()
          activePlaybackReplyIdRef.current = null
          inFlightReplyIdRef.current = null
          lastPlaybackFinishedAtMsRef.current = null
          player.pause()
          dispatchTalkEvent({ type: 'voiceDetected' })
          return
        }
        if (talkStateRef.current === 'listening') dispatchTalkEvent({ type: 'voiceDetected' })
        return
      }

      if (result.event === 'speechEnd' && talkStateRef.current === 'capturing') {
        resetReplyQueueForPrompt()
        dispatchTalkEvent({ type: 'silenceDetected' })
        void processRecordedSegment('listening')
      }
    },
    [
      clearReplyRoundFinishTimer,
      dispatchTalkEvent,
      isBargeInListeningAllowed,
      isNeuralBargeInMeteringAllowed,
      player,
      processRecordedSegment,
      resetReplyQueueForPrompt,
    ]
  )

  const startContinuousRecording = useCallback(async () => {
    if (
      !continuousEnabledRef.current ||
      recordingActiveRef.current ||
      processingSegmentRef.current
    ) {
      return
    }
    try {
      vadStateRef.current = createInitialVoiceVadState()
      resetNeuralVadDecision()
      await startRecorderSegment()
    } catch (recordError) {
      continuousEnabledRef.current = false
      setInputMode('push_to_talk')
      recordingActiveRef.current = false
      dispatchTalkEvent({
        message: recordError instanceof Error ? recordError.message : String(recordError),
        type: 'failed',
      })
    }
  }, [dispatchTalkEvent, resetNeuralVadDecision, startRecorderSegment])

  useEffect(() => {
    if (
      !continuousEnabledRef.current ||
      !recordingActiveRef.current ||
      processingSegmentRef.current
    ) {
      return
    }
    const metering = typeof recorderState.metering === 'number' ? recorderState.metering : null
    latestMeteringRef.current = metering
    if (metering !== null) latestMeteringAtMsRef.current = Date.now()
    if (
      !shouldUseVolumeVadFallback({
        latestNeuralSampleAtMs: latestUsableNeuralSampleAtMsRef.current,
        neuralEnabled: neuralVadShadowEnabled,
        nowMs: Date.now(),
      })
    ) {
      console.log(
        `[BARGEDBG] mode=volume-suppressed m=${typeof metering === 'number' ? metering.toFixed(1) : metering} reason=neural_recent`
      )
      return
    }
    const timestampMs =
      typeof recorderState.durationMillis === 'number' ? recorderState.durationMillis : Date.now()
    const result = applyVadMeteringSample(
      vadStateRef.current,
      {
        metering,
        timestampMs,
      },
      talkStateRef.current === 'speaking' ? BARGE_IN_VAD_CONFIG : DEFAULT_VAD_CONFIG
    )
    vadStateRef.current = result.state
    console.log(
      `[BARGEDBG] m=${typeof metering === 'number' ? metering.toFixed(1) : metering} floor=${typeof result.state.noiseFloorDb === 'number' ? result.state.noiseFloorDb.toFixed(1) : result.state.noiseFloorDb} talk=${talkStateRef.current} cfg=${talkStateRef.current === 'speaking' ? 'BARGE' : 'DEF'} ev=${result.event ?? 'none'}`
    )
    if (result.event === 'speechStart') {
      const activePlaybackReplyId = activePlaybackReplyIdRef.current
      const isBargeInCandidate =
        isBargeInListeningAllowed() &&
        talkStateRef.current === 'speaking' &&
        activePlaybackReplyId !== null
      if (isBargeInCandidate) {
        bargeInSpeechStartSampleCountRef.current += 1
        if (bargeInSpeechStartSampleCountRef.current < BARGE_IN_SPEECH_START_SAMPLE_COUNT) {
          vadStateRef.current = {
            ...result.state,
            phase: 'listening',
            recentSpeechDb: null,
            silenceStartedAtMs: null,
          }
          return
        }
        bargeInSpeechStartSampleCountRef.current = 0
        spokenReplyIdsRef.current.add(activePlaybackReplyId)
        replyQueueGenerationRef.current += 1
        clearReplyRoundFinishTimer()
        activePlaybackReplyIdRef.current = null
        inFlightReplyIdRef.current = null
        lastPlaybackFinishedAtMsRef.current = null
        player.pause()
        dispatchTalkEvent({ type: 'voiceDetected' })
        return
      }
      bargeInSpeechStartSampleCountRef.current = 0
      dispatchTalkEvent({ type: 'voiceDetected' })
      return
    }
    bargeInSpeechStartSampleCountRef.current = 0
    if (result.event === 'speechEnd') {
      resetReplyQueueForPrompt()
      dispatchTalkEvent({ type: 'silenceDetected' })
      void processRecordedSegment('listening')
    }
  }, [
    dispatchTalkEvent,
    clearReplyRoundFinishTimer,
    isBargeInListeningAllowed,
    neuralVadShadowEnabled,
    processRecordedSegment,
    player,
    recorderState.durationMillis,
    recorderState.metering,
    resetReplyQueueForPrompt,
  ])

  const startRecording = useCallback(async () => {
    if (talkStateRef.current !== 'idle' && talkStateRef.current !== 'error') return
    try {
      enableTalkbackPlayback()
      dispatchTalkEvent({ type: 'recordStart' })
      await startRecorderSegment()
    } catch (recordError) {
      recordingActiveRef.current = false
      dispatchTalkEvent({
        message: recordError instanceof Error ? recordError.message : String(recordError),
        type: 'failed',
      })
    }
  }, [dispatchTalkEvent, enableTalkbackPlayback, startRecorderSegment])

  const stopRecording = useCallback(async () => {
    if (!recordingActiveRef.current || talkStateRef.current !== 'recording') return
    dispatchTalkEvent({ type: 'recordStop' })
    await processRecordedSegment()
  }, [dispatchTalkEvent, processRecordedSegment])

  const startContinuousMode = useCallback(async () => {
    if (continuousEnabledRef.current || !connected) return
    setInputMode('continuous')
    setTranscript('')
    setError(null)
    enableTalkbackPlayback()
    continuousEnabledRef.current = true
    dispatchTalkEvent({ type: 'continuousStart' })
  }, [connected, dispatchTalkEvent, enableTalkbackPlayback])

  const stopContinuousMode = useCallback(async () => {
    const interruptedReplyId = inFlightReplyIdRef.current ?? activePlaybackReplyIdRef.current
    if (interruptedReplyId) spokenReplyIdsRef.current.add(interruptedReplyId)
    continuousEnabledRef.current = false
    processingSegmentRef.current = false
    resetReplyQueueForPrompt()
    resetNeuralVadDecision()
    bargeInSpeechStartSampleCountRef.current = 0
    vadStateRef.current = createInitialVoiceVadState()
    setInputMode('push_to_talk')
    dispatchTalkEvent({ type: 'continuousStop' })
    if (recordingActiveRef.current) {
      recordingActiveRef.current = false
      await recorderRef.current.stop().catch(() => {})
    }
    activePlaybackReplyIdRef.current = null
    player.pause()
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
    }).catch(() => {})
  }, [dispatchTalkEvent, player, resetNeuralVadDecision, resetReplyQueueForPrompt])

  const exitTalkMode = useCallback(() => {
    void stopContinuousMode()
  }, [stopContinuousMode])

  const stopTalkbackPlayback = useCallback(() => {
    const interruptedReplyId = inFlightReplyIdRef.current ?? activePlaybackReplyIdRef.current
    if (interruptedReplyId) spokenReplyIdsRef.current.add(interruptedReplyId)
    for (const reply of listPendingTalkbackReplies({
      activePlaybackReplyId: null,
      baselineReplyIds: promptBaselineReplyIdsRef.current,
      enabled: true,
      inFlightReplyId: null,
      messages: chatMessagesRef.current,
      spokenReplyIds: spokenReplyIdsRef.current,
    })) {
      spokenReplyIdsRef.current.add(reply.id)
    }
    resetReplyQueueForPrompt()
    player.pause()
    const continueListening = inputModeRef.current === 'continuous' && continuousEnabledRef.current
    dispatchTalkEvent({ continueListening, type: 'playbackFinished' })
    if (continueListening && !recordingActiveRef.current && !processingSegmentRef.current) {
      setContinuousRunnerTick((current) => current + 1)
    }
  }, [dispatchTalkEvent, player, resetReplyQueueForPrompt])

  // biome-ignore lint/correctness/useExhaustiveDependencies: continuousRunnerTick intentionally wakes this ref-based microphone runner after async failures clear processingSegmentRef.
  useEffect(() => {
    if (
      !continuousEnabledRef.current ||
      talkState !== 'listening' ||
      recordingActiveRef.current ||
      processingSegmentRef.current
    ) {
      return
    }
    void startContinuousRecording()
  }, [continuousRunnerTick, startContinuousRecording, talkState])

  // biome-ignore lint/correctness/useExhaustiveDependencies: talkbackQueueTick intentionally wakes this ref-based playback queue after a clip finishes without changing chatMessages.
  useEffect(() => {
    if (
      talkState !== 'idle' &&
      talkState !== 'listening' &&
      talkState !== 'waiting_for_orchestrator' &&
      talkState !== 'processing' &&
      talkState !== 'speaking'
    ) {
      return
    }
    if (!talkbackPlaybackEnabledRef.current) return
    if (!isTalkbackPlaybackAllowed()) return
    if (talkbackBaselinePendingRef.current) {
      const baseline = snapshotOrchestratorReplyIds(chatMessages)
      if (baseline.size === 0) return
      promptBaselineReplyIdsRef.current = baseline
      talkbackBaselinePendingRef.current = false
      return
    }
    const reply = listPendingTalkbackReplies({
      activePlaybackReplyId: activePlaybackReplyIdRef.current,
      enabled: true,
      baselineReplyIds: promptBaselineReplyIdsRef.current,
      inFlightReplyId: inFlightReplyIdRef.current,
      messages: chatMessages,
      spokenReplyIds: spokenReplyIdsRef.current,
    }).at(0)
    if (!reply || activePlaybackReplyIdRef.current) {
      return
    }
    clearReplyRoundFinishTimer()
    lastPlaybackFinishedAtMsRef.current = null
    inFlightReplyIdRef.current = reply.id
    const playbackGeneration = replyQueueGenerationRef.current
    const playbackStillCurrent = () =>
      replyQueueGenerationRef.current === playbackGeneration &&
      inFlightReplyIdRef.current === reply.id &&
      !activePlaybackReplyIdRef.current &&
      isTalkbackPlaybackAllowed() &&
      (talkStateRef.current === 'waiting_for_orchestrator' ||
        talkStateRef.current === 'processing' ||
        talkStateRef.current === 'speaking')
    dispatchTalkEvent({ type: 'replyDetected' })
    void (async () => {
      try {
        const keepRecordingForBargeIn = isBargeInListeningAllowed()
        if (recordingActiveRef.current && !keepRecordingForBargeIn) {
          await recorderRef.current.stop().catch(() => {})
          recordingActiveRef.current = false
        }
        const synthesisOptions = { voice: reply.voice }
        const streamed = (await synthesizeVoiceStream(reply.text, synthesisOptions)) as unknown
        if (!playbackStillCurrent()) return
        const synthesized = isVoiceSynthesisResult(streamed)
          ? streamed
          : ((await synthesizeVoice(reply.text, synthesisOptions)) as unknown)
        if (!isVoiceSynthesisResult(synthesized)) {
          throw new Error(t('talk.error.synthesisFailed'))
        }
        if (!playbackStillCurrent()) return
        if (keepRecordingForBargeIn) {
          vadStateRef.current = createInitialVoiceVadState()
          resetNeuralVadDecision()
          await startRecorderSegment()
        } else {
          await setAudioModeAsync({
            allowsRecording: false,
            playsInSilentMode: true,
          })
        }
        if (!playbackStillCurrent()) return
        player.replace({ uri: `data:${synthesized.mime};base64,${synthesized.audio}` })
        activePlaybackReplyIdRef.current = reply.id
        player.play()
      } catch (playError) {
        if (
          replyQueueGenerationRef.current !== playbackGeneration ||
          inFlightReplyIdRef.current !== reply.id
        ) {
          return
        }
        inFlightReplyIdRef.current = null
        activePlaybackReplyIdRef.current = null
        dispatchTalkEvent({
          message: playError instanceof Error ? playError.message : String(playError),
          type: 'failed',
        })
      }
    })()
  }, [
    chatMessages,
    clearReplyRoundFinishTimer,
    dispatchTalkEvent,
    isTalkbackPlaybackAllowed,
    player,
    isBargeInListeningAllowed,
    startRecorderSegment,
    synthesizeVoice,
    synthesizeVoiceStream,
    t,
    talkbackQueueTick,
    talkState,
  ])

  useEffect(() => {
    if (
      !activePlaybackReplyIdRef.current ||
      !playerStatus.isLoaded ||
      !playerStatus.didJustFinish
    ) {
      return
    }
    const replyId = activePlaybackReplyIdRef.current
    activePlaybackReplyIdRef.current = null
    player.pause()
    lastSpokenReplyIdRef.current = replyId
    spokenReplyIdsRef.current.add(replyId)
    inFlightReplyIdRef.current = null
    lastPlaybackFinishedAtMsRef.current = Date.now()

    const pendingReplies = listPendingTalkbackReplies({
      activePlaybackReplyId: activePlaybackReplyIdRef.current,
      baselineReplyIds: promptBaselineReplyIdsRef.current,
      enabled: true,
      inFlightReplyId: inFlightReplyIdRef.current,
      messages: chatMessagesRef.current,
      spokenReplyIds: spokenReplyIdsRef.current,
    })
    if (pendingReplies.length > 0) {
      setTalkbackQueueTick((current) => current + 1)
      return
    }

    clearReplyRoundFinishTimer()
    replyRoundFinishTimerRef.current = setTimeout(() => {
      const nextPendingReplies = listPendingTalkbackReplies({
        activePlaybackReplyId: activePlaybackReplyIdRef.current,
        baselineReplyIds: promptBaselineReplyIdsRef.current,
        enabled: true,
        inFlightReplyId: inFlightReplyIdRef.current,
        messages: chatMessagesRef.current,
        spokenReplyIds: spokenReplyIdsRef.current,
      })
      if (
        !shouldFinishTalkbackReplyRound({
          activePlaybackReplyId: activePlaybackReplyIdRef.current,
          idleTimeoutMs: TALKBACK_REPLY_IDLE_TIMEOUT_MS,
          inFlightReplyId: inFlightReplyIdRef.current,
          lastPlaybackFinishedAtMs: lastPlaybackFinishedAtMsRef.current,
          nowMs: Date.now(),
          pendingReplyCount: nextPendingReplies.length,
        })
      ) {
        if (nextPendingReplies.length > 0) setTalkbackQueueTick((current) => current + 1)
        return
      }
      replyRoundFinishTimerRef.current = null
      lastPlaybackFinishedAtMsRef.current = null
      const continueListening =
        inputModeRef.current === 'continuous' && continuousEnabledRef.current
      dispatchTalkEvent({ continueListening, type: 'playbackFinished' })
    }, TALKBACK_REPLY_IDLE_TIMEOUT_MS)
  }, [
    clearReplyRoundFinishTimer,
    dispatchTalkEvent,
    player,
    playerStatus.didJustFinish,
    playerStatus.isLoaded,
  ])

  const pushToTalkSelected = inputMode === 'push_to_talk'
  const continuousSelected = inputMode === 'continuous'
  const speaking = talkState === 'speaking'
  const errored = talkState === 'error'
  const visual = getTalkStateVisual(talkState)
  const immersive = talkState !== 'idle'
  const disabled =
    (!connected && !errored) ||
    (!speaking &&
      !errored &&
      (!pushToTalkSelected ||
        talkState === 'sending' ||
        talkState === 'waiting_for_orchestrator' ||
        talkState === 'processing'))
  const statusLabel = t(`talk.state.${talkState}`)
  // The mode switch only renders while idle (non-immersive), where continuous is
  // never actually running, so the orb/segment start it; once running (immersive)
  // the orb becomes the stop control.
  const continuousButtonLabel = immersive ? t('talk.continuous.stop') : t('talk.continuous.start')

  return (
    <Screen>
      <View style={[styles.container, immersive && styles.containerImmersive]}>
        {immersive ? (
          <View style={styles.immersiveActions}>
            <Pressable
              accessibilityRole="button"
              onPress={exitTalkMode}
              style={({ pressed }) => [styles.exitButton, pressed && styles.talkButtonPressed]}
            >
              <Ionicons color={colors.text} name="close-circle-outline" size={20} />
              <Text style={styles.exitButtonText}>{t('talk.exitIntercom')}</Text>
            </Pressable>
          </View>
        ) : null}

        {!immersive ? (
          <>
            <View style={styles.header}>
              <Text style={styles.kicker}>{t('talk.kicker')}</Text>
              <Text style={styles.title}>{t('talk.title')}</Text>
              <Text style={styles.subtitle}>{t('talk.subtitle')}</Text>
            </View>

            <View style={styles.modeSwitch}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (!pushToTalkSelected) void stopContinuousMode()
                }}
                style={[styles.modeButton, pushToTalkSelected && styles.modeButtonActive]}
              >
                <Ionicons
                  color={pushToTalkSelected ? colors.text : colors.textSoft}
                  name="hand-left-outline"
                  size={18}
                />
                <Text
                  style={[styles.modeButtonText, pushToTalkSelected && styles.modeButtonTextActive]}
                >
                  {t('talk.mode.pushToTalk')}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void startContinuousMode()}
                style={[styles.modeButton, continuousSelected && styles.modeButtonActive]}
              >
                <Ionicons
                  color={continuousSelected ? colors.text : colors.textSoft}
                  name="radio-outline"
                  size={18}
                />
                <Text
                  style={[styles.modeButtonText, continuousSelected && styles.modeButtonTextActive]}
                >
                  {t('talk.mode.continuous')}
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}

        <View
          style={[
            styles.statusPanel,
            { backgroundColor: visual.panel, borderColor: visual.accent },
            immersive && styles.statusPanelImmersive,
          ]}
        >
          <View style={[styles.statusDot, { backgroundColor: visual.accent }]} />
          <Text style={[styles.statusLabel, { color: visual.soft }]}>{statusLabel}</Text>
          {continuousSelected ? (
            <Text style={styles.statusHint}>
              {t('talk.vad.hint', {
                silenceMs: DEFAULT_VAD_CONFIG.silenceDurationMs,
                threshold: DEFAULT_VAD_CONFIG.silenceThresholdDb,
              })}
            </Text>
          ) : null}
          {!connected ? <Text style={styles.statusHint}>{t('talk.connectFirst')}</Text> : null}
          {transcript ? <Text style={styles.transcript}>{transcript}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        <Pressable
          accessibilityLabel={
            speaking ? t('talk.stopPlayback') : t('talk.button.accessibilityLabel')
          }
          accessibilityRole="button"
          disabled={
            errored ? false : speaking ? !connected : pushToTalkSelected ? disabled : !connected
          }
          onPress={
            errored
              ? exitTalkMode
              : speaking
                ? stopTalkbackPlayback
                : pushToTalkSelected
                  ? undefined
                  : talkState === 'idle'
                    ? () => void startContinuousMode()
                    : () => void stopContinuousMode()
          }
          onPressIn={
            pushToTalkSelected && !speaking && !errored ? () => void startRecording() : undefined
          }
          onPressOut={
            pushToTalkSelected && !speaking && !errored ? () => void stopRecording() : undefined
          }
          style={({ pressed }) => [
            styles.talkButton,
            {
              backgroundColor: hexToRgba(visual.accent, 0.1),
              borderColor: hexToRgba(visual.accent, 0.4),
            },
            immersive && styles.talkButtonImmersive,
            (speaking ? !connected : pushToTalkSelected ? disabled : !connected) &&
              styles.talkButtonDisabled,
            pressed && styles.talkButtonPressed,
          ]}
        >
          <TalkOrb accent={visual.accent} immersive={immersive} kind={visual.kind}>
            {speaking ? (
              <Ionicons color="#05070a" name="stop" size={34} />
            ) : talkState === 'sending' ||
              talkState === 'waiting_for_orchestrator' ||
              talkState === 'processing' ? (
              <ActivityIndicator color="#05070a" />
            ) : (
              <Ionicons
                color="#05070a"
                name={visual.icon as keyof typeof Ionicons.glyphMap}
                size={34}
              />
            )}
          </TalkOrb>
          <Text style={styles.buttonText}>
            {speaking
              ? t('talk.stopPlayback')
              : errored
                ? t('talk.exitIntercom')
                : pushToTalkSelected
                  ? talkState === 'recording'
                    ? t('talk.button.release')
                    : t('talk.button.hold')
                  : continuousButtonLabel}
          </Text>
        </Pressable>
      </View>
      {neuralVadPcmProbeEnabled || neuralVadShadowEnabled ? (
        <NeuralVadPcmProbe
          active={connected && inputMode === 'continuous' && talkState !== 'idle'}
          onScore={handleNeuralVadScore}
          pcmLogEnabled={neuralVadPcmProbeEnabled}
          shadowEnabled={neuralVadShadowEnabled}
        />
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  buttonText: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  container: {
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  containerImmersive: {
    backgroundColor: '#05070a',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  error: {
    color: colors.error,
    fontSize: 13,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  exitButton: {
    alignItems: 'center',
    alignSelf: 'center',
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  exitButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  header: {
    gap: spacing.xs,
  },
  immersiveActions: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  kicker: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  modeButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  modeButtonActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  modeButtonText: {
    color: colors.textSoft,
    fontSize: 13,
    fontWeight: '800',
  },
  modeButtonTextActive: {
    color: colors.text,
  },
  modeSwitch: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statusDot: {
    backgroundColor: colors.accent,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  statusHint: {
    color: colors.warning,
    fontSize: 13,
    lineHeight: 18,
  },
  statusLabel: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
  },
  statusPanel: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  statusPanelImmersive: {
    marginBottom: spacing.lg,
    padding: spacing.lg,
  },
  subtitle: {
    color: colors.textSoft,
    fontSize: 15,
    lineHeight: 22,
  },
  talkButton: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.accent,
    borderColor: colors.border,
    borderRadius: 104,
    borderWidth: 1,
    height: 208,
    justifyContent: 'center',
    width: 208,
  },
  talkButtonDisabled: {
    opacity: 0.45,
  },
  talkButtonImmersive: {
    borderRadius: 124,
    height: 248,
    width: 248,
  },
  talkButtonPressed: {
    transform: [{ scale: 0.98 }],
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '900',
  },
  transcript: {
    color: colors.textSoft,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  orb: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbGlyph: {
    alignItems: 'center',
    borderRadius: 38,
    height: 76,
    justifyContent: 'center',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 18,
    width: 76,
    zIndex: 2,
  },
  orbHalo: {
    borderRadius: 999,
    bottom: 6,
    left: 6,
    position: 'absolute',
    right: 6,
    top: 6,
  },
  orbRing: {
    borderRadius: 999,
    borderWidth: 2,
    position: 'absolute',
  },
  orbSpin: {
    borderColor: 'transparent',
    borderRadius: 999,
    borderWidth: 4,
    position: 'absolute',
  },
  waveBar: {
    borderRadius: 999,
    height: 34,
    width: 5,
  },
  waveRow: {
    alignItems: 'center',
    bottom: 14,
    flexDirection: 'row',
    gap: 5,
    height: 34,
    justifyContent: 'center',
    position: 'absolute',
  },
})
