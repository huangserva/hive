import { Ionicons } from '@expo/vector-icons'
import {
  type AudioRecorder,
  type RecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio'
import * as FileSystem from 'expo-file-system/legacy'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

import {
  type MobileVoiceSynthesisResult,
  useMobileRuntime,
} from '../../src/api/mobile-runtime-context'
import { Screen } from '../../src/components/Screen'
import { useT } from '../../src/i18n'
import {
  findNextTalkbackReply,
  reduceTalkbackState,
  runTalkbackInput,
  type TalkbackState,
} from '../../src/lib/push-to-talk'
import {
  applyVadMeteringSample,
  createInitialVoiceVadState,
  DEFAULT_VAD_CONFIG,
  type VoiceVadState,
} from '../../src/lib/voice-vad'
import { colors, radius, spacing } from '../../src/theme'

type TalkInputMode = 'push_to_talk' | 'continuous'

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

export default function TalkTab() {
  const {
    chatMessages,
    sendPromptToOrchestratorWithOutcome,
    state,
    synthesizeVoice,
    transcribeVoice,
  } = useMobileRuntime()
  const t = useT()
  const [talkState, setTalkState] = useState<TalkbackState>('idle')
  const [inputMode, setInputMode] = useState<TalkInputMode>('push_to_talk')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [continuousRunnerTick, setContinuousRunnerTick] = useState(0)
  const recordingOptions = useMemo(
    () => ({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true }),
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
  const recorderRef = useRef<AudioRecorder>(recorder)
  const recordingActiveRef = useRef(false)
  const activePlaybackReplyIdRef = useRef<string | null>(null)
  const chatMessagesRef = useRef(chatMessages)
  const lastSpokenReplyIdRef = useRef<string | null>(null)
  const promptBaselineReplyIdsRef = useRef<Set<string> | null>(null)
  const initializedReplyCursorRef = useRef(false)
  const inFlightReplyIdRef = useRef<string | null>(null)
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

  useEffect(() => {
    if (!initializedReplyCursorRef.current) {
      lastSpokenReplyIdRef.current = latestOrchestratorReplyId(chatMessages)
      initializedReplyCursorRef.current = true
    }
  }, [chatMessages])

  useEffect(() => {
    return () => {
      if (recordingActiveRef.current) void recorder.stop().catch(() => {})
      player.pause()
      player.remove()
    }
  }, [player, recorder])

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
        const uri = recorderForSegment.uri ?? recorderForSegment.getStatus().url
        if (!uri) throw new Error(t('talk.error.recordingMissing'))
        const audioBase64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        })
        promptBaselineReplyIdsRef.current = snapshotOrchestratorReplyIds(chatMessagesRef.current)
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
    [dispatchTalkEvent, sendPromptToOrchestratorWithOutcome, t, transcribeVoice]
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
  }, [dispatchTalkEvent, startRecorderSegment])

  useEffect(() => {
    if (
      !continuousEnabledRef.current ||
      !recordingActiveRef.current ||
      processingSegmentRef.current
    ) {
      return
    }
    const metering = typeof recorderState.metering === 'number' ? recorderState.metering : null
    const timestampMs =
      typeof recorderState.durationMillis === 'number' ? recorderState.durationMillis : Date.now()
    const result = applyVadMeteringSample(vadStateRef.current, {
      metering,
      timestampMs,
    })
    vadStateRef.current = result.state
    if (result.event === 'speechStart') {
      dispatchTalkEvent({ type: 'voiceDetected' })
      return
    }
    if (result.event === 'speechEnd') {
      promptBaselineReplyIdsRef.current = snapshotOrchestratorReplyIds(chatMessagesRef.current)
      dispatchTalkEvent({ type: 'silenceDetected' })
      void processRecordedSegment('listening')
    }
  }, [
    dispatchTalkEvent,
    processRecordedSegment,
    recorderState.durationMillis,
    recorderState.metering,
  ])

  const startRecording = useCallback(async () => {
    if (talkStateRef.current !== 'idle' && talkStateRef.current !== 'error') return
    try {
      dispatchTalkEvent({ type: 'recordStart' })
      await startRecorderSegment()
    } catch (recordError) {
      recordingActiveRef.current = false
      dispatchTalkEvent({
        message: recordError instanceof Error ? recordError.message : String(recordError),
        type: 'failed',
      })
    }
  }, [dispatchTalkEvent, startRecorderSegment])

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
    continuousEnabledRef.current = true
    dispatchTalkEvent({ type: 'continuousStart' })
  }, [connected, dispatchTalkEvent])

  const stopContinuousMode = useCallback(async () => {
    continuousEnabledRef.current = false
    processingSegmentRef.current = false
    promptBaselineReplyIdsRef.current = null
    vadStateRef.current = createInitialVoiceVadState()
    setInputMode('push_to_talk')
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
    dispatchTalkEvent({ type: 'continuousStop' })
  }, [dispatchTalkEvent, player])

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

  useEffect(() => {
    if (talkState !== 'waiting_for_orchestrator' && talkState !== 'processing') return
    const reply = findNextTalkbackReply({
      enabled: true,
      baselineReplyIds: promptBaselineReplyIdsRef.current,
      lastSpokenReplyId: lastSpokenReplyIdRef.current,
      messages: chatMessages,
    })
    if (!reply || inFlightReplyIdRef.current === reply.id || activePlaybackReplyIdRef.current) {
      return
    }
    inFlightReplyIdRef.current = reply.id
    dispatchTalkEvent({ type: 'replyDetected' })
    void (async () => {
      try {
        const synthesized = (await synthesizeVoice(reply.text)) as unknown
        if (!isVoiceSynthesisResult(synthesized)) {
          throw new Error(t('talk.error.synthesisFailed'))
        }
        player.replace({ uri: `data:${synthesized.mime};base64,${synthesized.audio}` })
        activePlaybackReplyIdRef.current = reply.id
        player.play()
      } catch (playError) {
        inFlightReplyIdRef.current = null
        activePlaybackReplyIdRef.current = null
        dispatchTalkEvent({
          message: playError instanceof Error ? playError.message : String(playError),
          type: 'failed',
        })
      }
    })()
  }, [chatMessages, dispatchTalkEvent, player, synthesizeVoice, t, talkState])

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
    inFlightReplyIdRef.current = null
    const continueListening = inputModeRef.current === 'continuous' && continuousEnabledRef.current
    dispatchTalkEvent({ continueListening, type: 'playbackFinished' })
  }, [dispatchTalkEvent, player, playerStatus.didJustFinish, playerStatus.isLoaded])

  const pushToTalkSelected = inputMode === 'push_to_talk'
  const continuousSelected = inputMode === 'continuous'
  const disabled =
    !connected ||
    !pushToTalkSelected ||
    talkState === 'sending' ||
    talkState === 'waiting_for_orchestrator' ||
    talkState === 'processing' ||
    talkState === 'speaking'
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
          accessibilityLabel={t('talk.button.accessibilityLabel')}
          accessibilityRole="button"
          disabled={pushToTalkSelected ? disabled : !connected}
          onPress={pushToTalkSelected ? undefined : () => void stopContinuousMode()}
          onPressIn={pushToTalkSelected ? () => void startRecording() : undefined}
          onPressOut={pushToTalkSelected ? () => void stopRecording() : undefined}
          style={({ pressed }) => [
            styles.talkButton,
            (talkState === 'recording' || talkState === 'capturing') && styles.talkButtonRecording,
            talkState === 'listening' && styles.talkButtonListening,
            (pushToTalkSelected ? disabled : !connected) && styles.talkButtonDisabled,
            pressed && styles.talkButtonPressed,
          ]}
        >
          {talkState === 'sending' ||
          talkState === 'waiting_for_orchestrator' ||
          talkState === 'processing' ||
          talkState === 'speaking' ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <Ionicons
              color={colors.text}
              name={continuousSelected ? 'radio-outline' : 'mic-outline'}
              size={48}
            />
          )}
          <Text style={styles.buttonText}>
            {pushToTalkSelected
              ? talkState === 'recording'
                ? t('talk.button.release')
                : t('talk.button.hold')
              : continuousButtonLabel}
          </Text>
        </Pressable>
      </View>
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
