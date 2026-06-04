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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native'

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
  buildNeuralVoiceVadDebugLine,
  createInitialNeuralVoiceVadState,
  type NeuralVoiceVadState,
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
  const [inputMode, setInputMode] = useState<TalkInputMode>('push_to_talk')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [continuousRunnerTick, setContinuousRunnerTick] = useState(0)
  const [talkbackQueueTick, setTalkbackQueueTick] = useState(0)
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
  const playerStatus = useAudioPlayerStatus(player)
  const talkStateRef = useRef<TalkbackState>('idle')
  const inputModeRef = useRef<TalkInputMode>('push_to_talk')
  const continuousEnabledRef = useRef(false)
  const processingSegmentRef = useRef(false)
  const vadStateRef = useRef<VoiceVadState>(createInitialVoiceVadState())
  const neuralVadStateRef = useRef<NeuralVoiceVadState>(createInitialNeuralVoiceVadState())
  const latestNeuralSampleAtMsRef = useRef<number | null>(null)
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
  const connected = state === 'connected'
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
    latestNeuralSampleAtMsRef.current = null
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
      player.remove()
    }
  }, [clearReplyRoundFinishTimer, player, recorder])

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
        if (
          nextStateOnError === 'listening' &&
          continuousEnabledRef.current &&
          !recordingActiveRef.current
        ) {
          dispatchTalkEvent({ type: 'continuousStart' })
        }
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
      latestNeuralSampleAtMsRef.current = score.timestampMs
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
        latestNeuralSampleAtMs: latestNeuralSampleAtMsRef.current,
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
  const disabled =
    !connected ||
    (!speaking &&
      (!pushToTalkSelected ||
        talkState === 'sending' ||
        talkState === 'waiting_for_orchestrator' ||
        talkState === 'processing'))
  const statusLabel = t(`talk.state.${talkState}`)
  const continuousButtonLabel = continuousSelected
    ? t('talk.continuous.stop')
    : t('talk.continuous.start')

  return (
    <Screen>
      <View style={styles.container}>
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
            onPress={() =>
              continuousSelected ? void stopContinuousMode() : void startContinuousMode()
            }
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

        <View style={styles.statusPanel}>
          <View style={[styles.statusDot, talkState === 'error' && styles.statusDotError]} />
          <Text style={styles.statusLabel}>{statusLabel}</Text>
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
          disabled={speaking ? !connected : pushToTalkSelected ? disabled : !connected}
          onPress={
            speaking
              ? stopTalkbackPlayback
              : pushToTalkSelected
                ? undefined
                : () => void stopContinuousMode()
          }
          onPressIn={pushToTalkSelected && !speaking ? () => void startRecording() : undefined}
          onPressOut={pushToTalkSelected && !speaking ? () => void stopRecording() : undefined}
          style={({ pressed }) => [
            styles.talkButton,
            (talkState === 'recording' || talkState === 'capturing') && styles.talkButtonRecording,
            speaking && styles.talkButtonRecording,
            talkState === 'listening' && styles.talkButtonListening,
            (speaking ? !connected : pushToTalkSelected ? disabled : !connected) &&
              styles.talkButtonDisabled,
            pressed && styles.talkButtonPressed,
          ]}
        >
          {speaking ? (
            <Ionicons color={colors.text} name="stop-circle-outline" size={48} />
          ) : talkState === 'sending' ||
            talkState === 'waiting_for_orchestrator' ||
            talkState === 'processing' ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <Ionicons
              color={colors.text}
              name={continuousSelected ? 'radio-outline' : 'mic-outline'}
              size={48}
            />
          )}
          <Text style={styles.buttonText}>
            {speaking
              ? t('talk.stopPlayback')
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
          active={connected && inputMode === 'continuous'}
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
    fontSize: 15,
    fontWeight: '800',
    marginTop: spacing.sm,
  },
  container: {
    flex: 1,
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  error: {
    color: colors.error,
    fontSize: 13,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  header: {
    gap: spacing.xs,
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
  statusDotError: {
    backgroundColor: colors.error,
  },
  statusHint: {
    color: colors.warning,
    fontSize: 13,
    lineHeight: 18,
  },
  statusLabel: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
  },
  statusPanel: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
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
    borderRadius: 96,
    borderWidth: 1,
    height: 192,
    justifyContent: 'center',
    width: 192,
  },
  talkButtonDisabled: {
    opacity: 0.45,
  },
  talkButtonPressed: {
    transform: [{ scale: 0.98 }],
  },
  talkButtonRecording: {
    backgroundColor: colors.error,
  },
  talkButtonListening: {
    backgroundColor: colors.success,
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
})
