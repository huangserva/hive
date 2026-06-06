import { Ionicons } from '@expo/vector-icons'
import {
  type AudioRecorder,
  type AudioStreamBuffer,
  getRecordingPermissionsAsync,
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
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg'

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
  DEFAULT_BARGE_IN_VOLUME_OVERRIDE_CONFIG,
  type NeuralVoiceSegmentQualityState,
  type NeuralVoiceVadState,
  recordNeuralVoiceSegmentQualitySample,
  shouldTriggerBargeInVolumeOverride,
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
type RecordingPermissionDebug = {
  canAskAgain?: boolean
  granted?: boolean
  status?: string
}
type TalkError = Error & { fatalTalkError?: boolean }

const TALKBACK_REPLY_IDLE_TIMEOUT_MS = 3500
const MAX_CONTINUOUS_RECORDER_START_SOFT_FAILURES = 2
const CONTINUOUS_RECORDER_START_RETRY_DELAY_MS = 1000
const BARGE_IN_VAD_CONFIG = {
  ...DEFAULT_VAD_CONFIG,
  confirmedSpeechMarginDb: 25,
  speechMarginDb: 25,
  startupSpeechThresholdDb: -26,
}
const BARGE_IN_SPEECH_START_SAMPLE_COUNT = 3
const BARGE_IN_METERING_FRESHNESS_MS = 500
const BARGE_IN_VOLUME_OVERRIDE_CONFIG = DEFAULT_BARGE_IN_VOLUME_OVERRIDE_CONFIG
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

const formatBargeInDb = (value: number | null) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : 'null'

const updateBargeInEchoBaselineDb = (current: number | null, metering: number | null) => {
  if (metering === null || !Number.isFinite(metering)) return current
  if (current === null || !Number.isFinite(current)) return metering
  return Math.max(current, metering)
}

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

const createTalkError = (message: string, options: { fatal?: boolean } = {}) => {
  const error = new Error(message) as TalkError
  if (options.fatal) error.fatalTalkError = true
  return error
}

const isFatalTalkError = (error: unknown) =>
  error instanceof Error && (error as TalkError).fatalTalkError === true

const summarizePermission = (permission?: RecordingPermissionDebug) => {
  if (!permission) return 'none'
  return `granted=${permission.granted ? '1' : '0'} canAskAgain=${permission.canAskAgain ? '1' : '0'} status=${permission.status ?? 'unknown'}`
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

// One soft expanding ring. Faithful to the 2026-06-05 redesign `.pulse` /
// `.sonar` keyframes (scale + fade), run on the reanimated UI thread for smooth
// on-device motion. Decoration only.
function PulseRing({
  color,
  delay,
  duration,
  size,
  toScale,
}: {
  color: string
  delay: number
  duration: number
  size: number
  toScale: number
}) {
  const progress = useSharedValue(0)
  useEffect(() => {
    progress.value = withDelay(delay, withRepeat(withTiming(1, { duration }), -1, false))
    return () => cancelAnimation(progress)
  }, [delay, duration, progress])
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - progress.value),
    transform: [{ scale: 0.92 + progress.value * (toScale - 0.92) }],
  }))
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.orbRing,
        { borderColor: color, borderRadius: size / 2, height: size, width: size },
        animatedStyle,
      ]}
    />
  )
}

// Rotating arc shown while processing (redesign `.spin`).
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
        {
          borderRadius: size / 2,
          borderRightColor: hexToRgba(color, 0.48),
          borderTopColor: hexToRgba(color, 0.95),
          height: size,
          width: size,
        },
        animatedStyle,
      ]}
    />
  )
}

// Pixel-faithful glowing sphere via react-native-svg RadialGradient — a 1:1
// translation of the 2026-06-05 redesign `.orb` CSS:
//   background: radial-gradient(circle at 35% 28%, #fff .9, #fff .28 16%,
//               state .35 42%, state .08 72%);  border: 1px state .38;
//   box-shadow: 0 0 48px state .28;  orb::before: inset 16 ring state .28.
// The outer glow is its own radial fade (state .28 → transparent). Decoration
// only — drawn behind the glyph, never touches the touch / logic layer.
function OrbSphere({ accent, size }: { accent: string; size: number }) {
  const canvas = Math.round(size * 1.5)
  const c = canvas / 2
  const sphereR = size / 2
  const id = accent.replace('#', '')
  return (
    <Svg
      height={canvas}
      pointerEvents="none"
      style={{ left: (size - canvas) / 2, position: 'absolute', top: (size - canvas) / 2 }}
      width={canvas}
    >
      <Defs>
        <RadialGradient cx="50%" cy="50%" id={`glow-${id}`} r="50%">
          <Stop offset="0" stopColor={accent} stopOpacity={0.28} />
          <Stop offset="0.55" stopColor={accent} stopOpacity={0.12} />
          <Stop offset="1" stopColor={accent} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient cx="35%" cy="28%" id={`sphere-${id}`} r="78%">
          <Stop offset="0" stopColor="#ffffff" stopOpacity={0.9} />
          <Stop offset="0.16" stopColor="#ffffff" stopOpacity={0.28} />
          <Stop offset="0.42" stopColor={accent} stopOpacity={0.35} />
          <Stop offset="0.72" stopColor={accent} stopOpacity={0.08} />
          <Stop offset="1" stopColor={accent} stopOpacity={0.08} />
        </RadialGradient>
      </Defs>
      {/* outer soft halo (box-shadow 0 0 48px state .28) */}
      <Circle cx={c} cy={c} fill={`url(#glow-${id})`} r={sphereR + 24} />
      {/* sphere body: radial white highlight → state colour */}
      <Circle
        cx={c}
        cy={c}
        fill={`url(#sphere-${id})`}
        r={sphereR}
        stroke={accent}
        strokeOpacity={0.38}
        strokeWidth={1}
      />
      {/* static inner concentric ring (orb::before inset 16) */}
      <Circle
        cx={c}
        cy={c}
        fill="none"
        r={sphereR - 16}
        stroke={accent}
        strokeOpacity={0.28}
        strokeWidth={1}
      />
    </Svg>
  )
}

// Animated orb: pixel-faithful SVG glowing sphere (OrbSphere) + per-state soft
// motion (breathing pulse / sonar / spin, all from the redesign spec) + center
// glyph. Decoration only; renders inside the existing Pressable and never touches
// the touch / logic layer.
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
  const orbSize = immersive ? 212 : 176
  return (
    <View style={[styles.orb, { height: orbSize, width: orbSize }]}>
      <OrbSphere accent={accent} size={orbSize} />
      {kind === 'listening' ? (
        <>
          <PulseRing
            color={hexToRgba(accent, 0.5)}
            delay={0}
            duration={2100}
            size={orbSize}
            toScale={1.45}
          />
          <PulseRing
            color={hexToRgba(accent, 0.4)}
            delay={700}
            duration={2100}
            size={orbSize}
            toScale={1.45}
          />
          <PulseRing
            color={hexToRgba(accent, 0.3)}
            delay={1400}
            duration={2100}
            size={orbSize}
            toScale={1.45}
          />
        </>
      ) : null}
      {kind === 'processing' ? <SpinArc color={accent} size={orbSize + 8} /> : null}
      {kind === 'speaking' ? (
        <>
          <PulseRing
            color={hexToRgba(accent, 0.52)}
            delay={0}
            duration={1700}
            size={orbSize}
            toScale={1.62}
          />
          <PulseRing
            color={hexToRgba(accent, 0.36)}
            delay={820}
            duration={1700}
            size={orbSize}
            toScale={1.62}
          />
        </>
      ) : null}
      <View
        pointerEvents="none"
        style={[styles.orbGlyph, { backgroundColor: accent, shadowColor: accent }]}
      >
        {children}
      </View>
    </View>
  )
}

// Activity / level dots shown directly under the orb (redesign hero), a static
// graduated row — kept calm (no mechanical motion) per the redesign's soft style.
const DOT_OPACITIES = [0.3, 0.5, 0.72, 1, 0.72, 0.5, 0.3]
function DotsRow({ color }: { color: string }) {
  return (
    <View pointerEvents="none" style={styles.dotsRow}>
      {DOT_OPACITIES.map((opacity, index) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static decorative dot row
          key={index}
          style={[styles.dot, { backgroundColor: color, opacity }]}
        />
      ))}
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
  // Transcript is surfaced in the chat tab, not in the immersive talk view (per
  // the redesign). We still capture it so chat history stays complete.
  const [, setTranscript] = useState('')
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
  const continuousRecorderStartFailureCountRef = useRef(0)
  const continuousRecorderRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const vadStateRef = useRef<VoiceVadState>(createInitialVoiceVadState())
  const neuralVadStateRef = useRef<NeuralVoiceVadState>(createInitialNeuralVoiceVadState())
  const neuralVoiceSegmentQualityRef = useRef<NeuralVoiceSegmentQualityState>(
    createInitialNeuralVoiceSegmentQualityState()
  )
  const latestUsableNeuralSampleAtMsRef = useRef<number | null>(null)
  const latestMeteringRef = useRef<number | null>(null)
  const latestMeteringAtMsRef = useRef<number | null>(null)
  const bargeInEchoBaselineDbRef = useRef<number | null>(null)
  const bargeInSpeechStartSampleCountRef = useRef(0)
  const recorderRef = useRef<AudioRecorder>(recorder)
  const recordingActiveRef = useRef(false)
  const latestAudioModeDebugRef = useRef<'idle' | 'playback' | 'recording'>('idle')
  const latestPermissionDebugRef = useRef<{
    get?: RecordingPermissionDebug
    request?: RecordingPermissionDebug
  }>({})
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

  const logTalkErrorDebug = useCallback(
    (
      phase: 'playback' | 'process_segment' | 'start_recorder',
      error: unknown,
      extra: Record<string, string | number | boolean | null | undefined> = {}
    ) => {
      const fields = Object.entries(extra)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' ')
      console.log(
        `[TALKERRDBG] phase=${phase} talk=${talkStateRef.current} input=${inputModeRef.current} recording_active=${recordingActiveRef.current ? '1' : '0'} processing=${processingSegmentRef.current ? '1' : '0'} audio_mode=${latestAudioModeDebugRef.current} permission_get="${summarizePermission(latestPermissionDebugRef.current.get)}" permission_request="${summarizePermission(latestPermissionDebugRef.current.request)}" fatal=${isFatalTalkError(error) ? '1' : '0'} error="${error instanceof Error ? error.message : String(error)}"${fields ? ` ${fields}` : ''}`
      )
    },
    []
  )

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

  const clearContinuousRecorderRetryTimer = useCallback(() => {
    if (continuousRecorderRetryTimerRef.current) {
      clearTimeout(continuousRecorderRetryTimerRef.current)
    }
    continuousRecorderRetryTimerRef.current = null
  }, [])

  const resetReplyQueueForPrompt = useCallback(() => {
    replyQueueGenerationRef.current += 1
    bargeInSpeechStartSampleCountRef.current = 0
    bargeInEchoBaselineDbRef.current = null
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

  const interruptActivePlaybackForBargeIn = useCallback(
    (replyId: string) => {
      spokenReplyIdsRef.current.add(replyId)
      replyQueueGenerationRef.current += 1
      clearReplyRoundFinishTimer()
      activePlaybackReplyIdRef.current = null
      inFlightReplyIdRef.current = null
      lastPlaybackFinishedAtMsRef.current = null
      bargeInSpeechStartSampleCountRef.current = 0
      bargeInEchoBaselineDbRef.current = null
      player.pause()
      dispatchTalkEvent({ type: 'voiceDetected' })
    },
    [clearReplyRoundFinishTimer, dispatchTalkEvent, player]
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
      clearContinuousRecorderRetryTimer()
      if (recordingActiveRef.current) void recorder.stop().catch(() => {})
      player.pause()
      cuePlayer.pause()
      player.remove()
      cuePlayer.remove()
    }
  }, [clearContinuousRecorderRetryTimer, clearReplyRoundFinishTimer, cuePlayer, player, recorder])

  const startRecorderSegment = useCallback(
    async (targetRecorder: AudioRecorder = recorderRef.current) => {
      latestPermissionDebugRef.current = {}
      let permission = await getRecordingPermissionsAsync()
      latestPermissionDebugRef.current.get = permission
      console.log(
        `[TALKERRDBG] phase=start_recorder step=permission_get ${summarizePermission(permission)}`
      )
      if (!permission.granted && permission.canAskAgain) {
        permission = await requestRecordingPermissionsAsync()
        latestPermissionDebugRef.current.request = permission
        console.log(
          `[TALKERRDBG] phase=start_recorder step=permission_request ${summarizePermission(permission)}`
        )
      }
      if (!permission.granted) {
        throw createTalkError(t('talk.error.microphoneDenied'), { fatal: true })
      }
      player.pause()
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      })
      latestAudioModeDebugRef.current = 'recording'
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
    async (
      nextStateOnError: 'error' | 'listening' = 'error',
      options: { skipWhenNoRealSpeech?: boolean } = {}
    ) => {
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
        latestAudioModeDebugRef.current = 'playback'
        if (
          nextStateOnError === 'listening' &&
          options.skipWhenNoRealSpeech &&
          !vadStateRef.current.hadRealSpeech
        ) {
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
        logTalkErrorDebug('process_segment', sendError, { next_state: nextStateOnError })
        if (nextStateOnError === 'listening' && !isFatalTalkError(sendError)) {
          resetReplyQueueForPrompt()
          dispatchTalkEvent({ type: 'reset' })
          if (continuousEnabledRef.current) dispatchTalkEvent({ type: 'continuousStart' })
          return
        }
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
      logTalkErrorDebug,
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
          interruptActivePlaybackForBargeIn(activePlaybackReplyId)
          return
        }
        if (talkStateRef.current === 'listening') dispatchTalkEvent({ type: 'voiceDetected' })
        return
      }

      if (result.event === 'speechEnd' && talkStateRef.current === 'capturing') {
        resetReplyQueueForPrompt()
        dispatchTalkEvent({ type: 'silenceDetected' })
        void processRecordedSegment('listening', { skipWhenNoRealSpeech: true })
      }
    },
    [
      dispatchTalkEvent,
      interruptActivePlaybackForBargeIn,
      isBargeInListeningAllowed,
      isNeuralBargeInMeteringAllowed,
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
      continuousRecorderStartFailureCountRef.current = 0
      clearContinuousRecorderRetryTimer()
    } catch (recordError) {
      logTalkErrorDebug('start_recorder', recordError, { step: 'continuous_start' })
      recordingActiveRef.current = false
      if (!isFatalTalkError(recordError)) {
        continuousRecorderStartFailureCountRef.current += 1
        if (
          continuousRecorderStartFailureCountRef.current >
          MAX_CONTINUOUS_RECORDER_START_SOFT_FAILURES
        ) {
          clearContinuousRecorderRetryTimer()
          continuousEnabledRef.current = false
          dispatchTalkEvent({
            message: recordError instanceof Error ? recordError.message : String(recordError),
            type: 'failed',
          })
          return
        }
        if (!continuousRecorderRetryTimerRef.current) {
          continuousRecorderRetryTimerRef.current = setTimeout(() => {
            continuousRecorderRetryTimerRef.current = null
            if (continuousEnabledRef.current && !recordingActiveRef.current) {
              setContinuousRunnerTick((current) => current + 1)
            }
          }, CONTINUOUS_RECORDER_START_RETRY_DELAY_MS)
        }
        dispatchTalkEvent({ type: 'reset' })
        if (continuousEnabledRef.current) {
          dispatchTalkEvent({ type: 'continuousStart' })
        }
        return
      }
      continuousEnabledRef.current = false
      clearContinuousRecorderRetryTimer()
      dispatchTalkEvent({
        message: recordError instanceof Error ? recordError.message : String(recordError),
        type: 'failed',
      })
    }
  }, [
    clearContinuousRecorderRetryTimer,
    dispatchTalkEvent,
    logTalkErrorDebug,
    resetNeuralVadDecision,
    startRecorderSegment,
  ])

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
      const activePlaybackReplyId = activePlaybackReplyIdRef.current
      const isBargeInCandidate =
        isBargeInListeningAllowed() &&
        talkStateRef.current === 'speaking' &&
        activePlaybackReplyId !== null
      if (isBargeInCandidate) {
        const decision = shouldTriggerBargeInVolumeOverride({
          baselineDb: bargeInEchoBaselineDbRef.current,
          config: BARGE_IN_VOLUME_OVERRIDE_CONFIG,
          meteringDb: metering,
        })
        console.log(
          `[BARGEDBG] mode=volume-neural-override m=${formatBargeInDb(metering)} baseline=${formatBargeInDb(decision.baselineDb)} delta=${formatBargeInDb(decision.deltaDb)} absolute=${decision.absolute ? '1' : '0'} relative=${decision.relative ? '1' : '0'} override=${decision.shouldOverride ? '1' : '0'} reason=neural_recent`
        )
        if (decision.shouldOverride) {
          interruptActivePlaybackForBargeIn(activePlaybackReplyId)
          return
        }
        bargeInEchoBaselineDbRef.current = updateBargeInEchoBaselineDb(
          bargeInEchoBaselineDbRef.current,
          metering
        )
      }
      console.log(
        `[BARGEDBG] mode=volume-suppressed m=${typeof metering === 'number' ? metering.toFixed(1) : metering} baseline=${formatBargeInDb(bargeInEchoBaselineDbRef.current)} reason=neural_recent`
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
        interruptActivePlaybackForBargeIn(activePlaybackReplyId)
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
      void processRecordedSegment('listening', { skipWhenNoRealSpeech: true })
    }
  }, [
    dispatchTalkEvent,
    isBargeInListeningAllowed,
    interruptActivePlaybackForBargeIn,
    neuralVadShadowEnabled,
    processRecordedSegment,
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
      logTalkErrorDebug('start_recorder', recordError, { step: 'push_to_talk_start' })
      dispatchTalkEvent({
        message: recordError instanceof Error ? recordError.message : String(recordError),
        type: 'failed',
      })
    }
  }, [dispatchTalkEvent, enableTalkbackPlayback, logTalkErrorDebug, startRecorderSegment])

  const stopRecording = useCallback(async () => {
    if (!recordingActiveRef.current || talkStateRef.current !== 'recording') return
    dispatchTalkEvent({ type: 'recordStop' })
    await processRecordedSegment('listening')
  }, [dispatchTalkEvent, processRecordedSegment])

  const startContinuousMode = useCallback(async () => {
    if (continuousEnabledRef.current || !connected) return
    setInputMode('continuous')
    setTranscript('')
    setError(null)
    enableTalkbackPlayback()
    continuousRecorderStartFailureCountRef.current = 0
    clearContinuousRecorderRetryTimer()
    continuousEnabledRef.current = true
    dispatchTalkEvent({ type: 'continuousStart' })
  }, [clearContinuousRecorderRetryTimer, connected, dispatchTalkEvent, enableTalkbackPlayback])

  const stopContinuousMode = useCallback(
    async (options: { preserveMode?: boolean } = {}) => {
      const interruptedReplyId = inFlightReplyIdRef.current ?? activePlaybackReplyIdRef.current
      if (interruptedReplyId) spokenReplyIdsRef.current.add(interruptedReplyId)
      continuousEnabledRef.current = false
      processingSegmentRef.current = false
      continuousRecorderStartFailureCountRef.current = 0
      clearContinuousRecorderRetryTimer()
      resetReplyQueueForPrompt()
      resetNeuralVadDecision()
      bargeInSpeechStartSampleCountRef.current = 0
      vadStateRef.current = createInitialVoiceVadState()
      if (!options.preserveMode) setInputMode('push_to_talk')
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
      latestAudioModeDebugRef.current = 'idle'
    },
    [
      clearContinuousRecorderRetryTimer,
      dispatchTalkEvent,
      player,
      resetNeuralVadDecision,
      resetReplyQueueForPrompt,
    ]
  )

  const exitTalkMode = useCallback(() => {
    void stopContinuousMode({ preserveMode: true })
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
      processingSegmentRef.current ||
      continuousRecorderRetryTimerRef.current
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
          try {
            await startRecorderSegment()
          } catch (bargeInRecorderError) {
            recordingActiveRef.current = false
            logTalkErrorDebug('start_recorder', bargeInRecorderError, {
              soft: true,
              step: 'barge_in_playback_start',
            })
            await setAudioModeAsync({
              allowsRecording: false,
              playsInSilentMode: true,
            }).catch((audioModeError: unknown) => {
              logTalkErrorDebug('playback', audioModeError, {
                soft: true,
                step: 'barge_in_fallback_audio_mode',
              })
            })
            latestAudioModeDebugRef.current = 'playback'
          }
        } else {
          await setAudioModeAsync({
            allowsRecording: false,
            playsInSilentMode: true,
          })
          latestAudioModeDebugRef.current = 'playback'
        }
        if (!playbackStillCurrent()) return
        player.replace({ uri: `data:${synthesized.mime};base64,${synthesized.audio}` })
        activePlaybackReplyIdRef.current = reply.id
        bargeInEchoBaselineDbRef.current = null
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
        logTalkErrorDebug('playback', playError, { reply_id: reply.id })
        if (!isFatalTalkError(playError)) {
          spokenReplyIdsRef.current.add(reply.id)
          const continueListening =
            inputModeRef.current === 'continuous' && continuousEnabledRef.current
          dispatchTalkEvent({ continueListening, type: 'playbackFinished' })
          if (continueListening && !recordingActiveRef.current && !processingSegmentRef.current) {
            setContinuousRunnerTick((current) => current + 1)
          }
          return
        }
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
    logTalkErrorDebug,
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
    bargeInEchoBaselineDbRef.current = null
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
  const headline = t(`talk.headline.${visual.kind}`)
  const modeLabel = continuousSelected ? t('talk.mode.continuous') : t('talk.mode.pushToTalk')
  const topMeta = `${modeLabel} · ${connected ? t('talk.meta.ready') : t('talk.meta.offline')}`
  const bottomSubtitle = !connected
    ? t('talk.connectFirst')
    : continuousSelected
      ? t('talk.continuous.hint')
      : t('talk.subtitle')
  const showActivityDots = visual.kind === 'listening' || visual.kind === 'speaking'

  return (
    <Screen>
      <View style={[styles.container, immersive && styles.containerImmersive]}>
        {/* top: compact status pill row (state pill · mode/ready) */}
        <View style={styles.topRow}>
          <View
            style={[
              styles.pill,
              { backgroundColor: visual.panel, borderColor: hexToRgba(visual.accent, 0.4) },
            ]}
          >
            <View style={[styles.pillDot, { backgroundColor: visual.accent }]} />
            <Text numberOfLines={1} style={[styles.pillLabel, { color: visual.soft }]}>
              {statusLabel}
            </Text>
          </View>
          <View style={styles.topRight}>
            <Text numberOfLines={1} style={styles.topMeta}>
              {topMeta}
            </Text>
            {/* Always-on quick exit / panic stop (redesign omitted it; user-required).
                Reuses exitTalkMode → stops any recording + playback and returns to idle. */}
            <Pressable
              accessibilityLabel={t('talk.exitIntercom')}
              accessibilityRole="button"
              hitSlop={10}
              onPress={exitTalkMode}
              style={({ pressed }) => [styles.exitBadge, pressed && styles.exitBadgePressed]}
              testID="talk-exit"
            >
              <Ionicons color={colors.textSoft} name="close" size={16} />
            </Pressable>
          </View>
        </View>

        {/* center: the orb IS the control (tap = start / stop / interrupt / exit) + activity dots */}
        <View style={styles.center}>
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
              immersive && styles.talkButtonImmersive,
              (speaking ? !connected : pushToTalkSelected ? disabled : !connected) &&
                styles.talkButtonDisabled,
              pressed && styles.talkButtonPressed,
            ]}
            testID="talk-orb"
          >
            <TalkOrb accent={visual.accent} immersive={immersive} kind={visual.kind}>
              <Ionicons
                color="#05070a"
                name={visual.icon as keyof typeof Ionicons.glyphMap}
                size={immersive ? 38 : 34}
              />
            </TalkOrb>
          </Pressable>
          {showActivityDots ? <DotsRow color={visual.accent} /> : null}
        </View>

        {/* bottom: big state headline + subtitle (+ mode switch while idle) */}
        <View style={styles.bottom}>
          {error ? (
            <Text numberOfLines={2} style={styles.errorLowKey}>
              {error}
            </Text>
          ) : null}
          <Text style={[styles.headline, { color: visual.soft }]}>{headline}</Text>
          <Text style={styles.headlineSub}>{bottomSubtitle}</Text>
          {!immersive ? (
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
                  name="mic-outline"
                  size={18}
                />
                <Text
                  style={[styles.modeButtonText, continuousSelected && styles.modeButtonTextActive]}
                >
                  {t('talk.mode.continuous')}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
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
  container: {
    backgroundColor: '#05070a',
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  containerImmersive: {
    backgroundColor: '#05070a',
  },
  // top compact status pill row
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: 34,
  },
  pill: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    maxWidth: '62%',
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  pillDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  pillLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  topRight: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  topMeta: {
    color: colors.muted,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
  exitBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 15,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  exitBadgePressed: {
    opacity: 0.6,
  },
  // center: orb + activity dots
  center: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
  },
  dotsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  // bottom: big state headline + subtitle + (idle) mode switch
  bottom: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  headline: {
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  headlineSub: {
    color: colors.muted,
    fontSize: 13.5,
    lineHeight: 19,
    maxWidth: 280,
    textAlign: 'center',
  },
  errorLowKey: {
    color: colors.error,
    fontSize: 12.5,
    lineHeight: 17,
    maxWidth: 280,
    opacity: 0.85,
    textAlign: 'center',
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
    marginTop: spacing.sm,
    width: '100%',
  },
  talkButton: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'transparent',
    borderRadius: 104,
    borderWidth: 0,
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
  orb: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbGlyph: {
    alignItems: 'center',
    borderRadius: 38,
    height: 76,
    justifyContent: 'center',
    shadowOffset: { height: 15, width: 0 },
    shadowOpacity: 0.36,
    shadowRadius: 20,
    width: 76,
    zIndex: 2,
  },
  orbRing: {
    borderWidth: 2,
    position: 'absolute',
  },
  orbSpin: {
    borderColor: 'transparent',
    borderWidth: 4,
    position: 'absolute',
  },
})
