import { Ionicons } from '@expo/vector-icons'
import { Audio } from 'expo-av'
import * as FileSystem from 'expo-file-system'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  const talkStateRef = useRef<TalkbackState>('idle')
  const continuousEnabledRef = useRef(false)
  const processingSegmentRef = useRef(false)
  const vadStateRef = useRef<VoiceVadState>(createInitialVoiceVadState())
  const recordingRef = useRef<Audio.Recording | null>(null)
  const activeSoundRef = useRef<Audio.Sound | null>(null)
  const chatMessagesRef = useRef(chatMessages)
  const lastSpokenReplyIdRef = useRef<string | null>(null)
  const promptBaselineReplyIdsRef = useRef<Set<string> | null>(null)
  const initializedReplyCursorRef = useRef(false)
  const inFlightReplyIdRef = useRef<string | null>(null)
  const connected = state === 'connected'
  chatMessagesRef.current = chatMessages

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
      void recordingRef.current?.stopAndUnloadAsync().catch(() => {})
      void activeSoundRef.current?.unloadAsync().catch(() => {})
    }
  }, [])

  const createRecording = useCallback(
    async ({ enableMetering }: { enableMetering: boolean }) => {
      const permission = await Audio.requestPermissionsAsync()
      if (!permission.granted) {
        throw new Error(t('talk.error.microphoneDenied'))
      }
      await activeSoundRef.current?.unloadAsync().catch(() => {})
      activeSoundRef.current = null
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      })
      const options = {
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: enableMetering,
      }
      const { recording } = await Audio.Recording.createAsync(options)
      return recording
    },
    [t]
  )

  const processRecordedSegment = useCallback(
    async (recording: Audio.Recording, nextStateOnError: 'error' | 'listening' = 'error') => {
      if (processingSegmentRef.current) return
      processingSegmentRef.current = true
      if (recordingRef.current === recording) recordingRef.current = null
      try {
        await recording.stopAndUnloadAsync()
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        })
        const uri = recording.getURI()
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
        if (nextStateOnError === 'listening' && continuousEnabledRef.current) {
          dispatchTalkEvent({ type: 'continuousStart' })
        }
      } finally {
        processingSegmentRef.current = false
        if (
          continuousEnabledRef.current &&
          talkStateRef.current === 'listening' &&
          !recordingRef.current
        ) {
          setContinuousRunnerTick((current) => current + 1)
        }
      }
    },
    [dispatchTalkEvent, sendPromptToOrchestratorWithOutcome, t, transcribeVoice]
  )

  const startContinuousRecording = useCallback(async () => {
    if (!continuousEnabledRef.current || recordingRef.current || processingSegmentRef.current) {
      return
    }
    try {
      vadStateRef.current = createInitialVoiceVadState()
      const recording = await createRecording({ enableMetering: true })
      recordingRef.current = recording
      await recording.setProgressUpdateInterval(200)
      recording.setOnRecordingStatusUpdate((status) => {
        if (!continuousEnabledRef.current || processingSegmentRef.current) return
        const metering =
          'metering' in status && typeof status.metering === 'number' ? status.metering : null
        const timestampMs =
          'durationMillis' in status && typeof status.durationMillis === 'number'
            ? status.durationMillis
            : Date.now()
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
          void processRecordedSegment(recording, 'listening')
        }
      })
    } catch (recordError) {
      continuousEnabledRef.current = false
      setInputMode('push_to_talk')
      recordingRef.current = null
      dispatchTalkEvent({
        message: recordError instanceof Error ? recordError.message : String(recordError),
        type: 'failed',
      })
    }
  }, [createRecording, dispatchTalkEvent, processRecordedSegment])

  const startRecording = useCallback(async () => {
    if (talkStateRef.current !== 'idle' && talkStateRef.current !== 'error') return
    try {
      dispatchTalkEvent({ type: 'recordStart' })
      const recording = await createRecording({ enableMetering: false })
      recordingRef.current = recording
    } catch (recordError) {
      recordingRef.current = null
      dispatchTalkEvent({
        message: recordError instanceof Error ? recordError.message : String(recordError),
        type: 'failed',
      })
    }
  }, [createRecording, dispatchTalkEvent])

  const stopRecording = useCallback(async () => {
    const recording = recordingRef.current
    if (!recording || talkStateRef.current !== 'recording') return
    recordingRef.current = null
    dispatchTalkEvent({ type: 'recordStop' })
    await processRecordedSegment(recording)
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
    const recording = recordingRef.current
    recordingRef.current = null
    if (recording) {
      await recording.stopAndUnloadAsync().catch(() => {})
    }
    await activeSoundRef.current?.unloadAsync().catch(() => {})
    activeSoundRef.current = null
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    }).catch(() => {})
    dispatchTalkEvent({ type: 'continuousStop' })
  }, [dispatchTalkEvent])

  // biome-ignore lint/correctness/useExhaustiveDependencies: continuousRunnerTick intentionally wakes this ref-based microphone runner after async failures clear processingSegmentRef.
  useEffect(() => {
    if (
      !continuousEnabledRef.current ||
      talkState !== 'listening' ||
      recordingRef.current ||
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
    if (!reply || inFlightReplyIdRef.current === reply.id) return
    inFlightReplyIdRef.current = reply.id
    dispatchTalkEvent({ type: 'replyDetected' })
    void (async () => {
      try {
        const synthesized = (await synthesizeVoice(reply.text)) as unknown
        if (!isVoiceSynthesisResult(synthesized)) {
          throw new Error(t('talk.error.synthesisFailed'))
        }
        const { sound } = await Audio.Sound.createAsync(
          { uri: `data:${synthesized.mime};base64,${synthesized.audio}` },
          { shouldPlay: true }
        )
        activeSoundRef.current = sound
        await new Promise<void>((resolve) => {
          sound.setOnPlaybackStatusUpdate((status) => {
            if (status.isLoaded && status.didJustFinish) resolve()
          })
        })
        await sound.unloadAsync()
        activeSoundRef.current = null
        lastSpokenReplyIdRef.current = reply.id
        inFlightReplyIdRef.current = null
        const continueListening = inputMode === 'continuous' && continuousEnabledRef.current
        dispatchTalkEvent({ continueListening, type: 'playbackFinished' })
      } catch (playError) {
        inFlightReplyIdRef.current = null
        dispatchTalkEvent({
          message: playError instanceof Error ? playError.message : String(playError),
          type: 'failed',
        })
      }
    })()
  }, [chatMessages, dispatchTalkEvent, inputMode, synthesizeVoice, t, talkState])

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
