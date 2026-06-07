import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useMobileRuntime } from '../src/api/mobile-runtime-context'
import type { VoiceCallStatePhase } from '../src/api/voice-call-state-protocol'
import { GlowOrb, type GlowOrbKind, hexToRgba } from '../src/components/Orb'
import { useT } from '../src/i18n'
import {
  advanceCallPhaseDisplay,
  type CallPhase,
  type CallPhaseDisplayState,
  enqueueCallPhaseDisplay,
  formatCallDuration,
  getCallPhaseLabelKey,
  isConnectedPhase,
  MIN_CALL_PHASE_DWELL_MS,
  resolveCallPhase,
} from '../src/lib/call-ui'

// Full-screen WebRTC call page (entered from the talk page 📞 icon as a
// fullScreenModal). Reuses the talk page's premium glowing orb. Pure UI + state
// wiring on top of the existing webRtcTestCall hook — it does NOT touch the talk
// page logic layer (state machine / cue / barge-in / quality gate / reply queue).

const CALL_BG = '#05070a'
const DEBUG_PHASES: VoiceCallStatePhase[] = ['listening', 'heard', 'processing', 'responding']

type CallVisual = {
  accent: string
  glyph: keyof typeof Ionicons.glyphMap
  kind: GlowOrbKind
  panel: string
  soft: string
}

// Premium driving palette, identical hues to the 6-05 talk redesign + call design
// (.hive/reports/2026-06-06-webrtc-call-ui-design.html).
const CALL_VISUALS: Record<CallPhase, CallVisual> = {
  connecting: {
    accent: '#FFD166',
    glyph: 'call',
    kind: 'listening',
    panel: 'rgba(255, 209, 102, 0.16)',
    soft: '#ffe08a',
  },
  ended: {
    accent: '#B5BDC8',
    glyph: 'call',
    kind: 'idle',
    panel: 'rgba(181, 189, 200, 0.16)',
    soft: '#d7dde4',
  },
  error: {
    accent: '#FF6B6B',
    glyph: 'warning-outline',
    kind: 'error',
    panel: 'rgba(255, 107, 107, 0.16)',
    soft: '#ffb0b0',
  },
  heard: {
    accent: '#00E5FF',
    glyph: 'radio',
    kind: 'heard',
    panel: 'rgba(0, 229, 255, 0.18)',
    soft: '#8ff5ff',
  },
  listening: {
    accent: '#46E6A9',
    glyph: 'mic',
    kind: 'listening',
    panel: 'rgba(70, 230, 169, 0.16)',
    soft: '#7cffcb',
  },
  processing: {
    accent: '#FFB000',
    glyph: 'sync',
    kind: 'processing',
    panel: 'rgba(255, 176, 0, 0.18)',
    soft: '#ffd36a',
  },
  responding: {
    accent: '#2F80FF',
    glyph: 'volume-high',
    kind: 'responding',
    panel: 'rgba(47, 128, 255, 0.18)',
    soft: '#9bc4ff',
  },
}

// A line of the rolling call transcript. The M39 streaming-ASR partial stream is
// not yet exposed to the mobile runtime context (see research note) — this page
// renders an elegant placeholder for now and is ready to render these lines once
// a `webRtcTranscript` stream / onPartial callback lands on the runtime context.
export type CallTranscriptLine = {
  id: string
  partial?: boolean
  text: string
  who: 'ai' | 'u'
}

export default function CallScreen() {
  const {
    setWebRtcCallMuted,
    startWebRtcTestCall,
    stopWebRtcTestCall,
    webRtcCallPhase,
    webRtcTestCall,
  } = useMobileRuntime()
  const router = useRouter()
  const t = useT()

  const [muted, setMuted] = useState(false)
  const [ended, setEnded] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [debugPhase, setDebugPhase] = useState<VoiceCallStatePhase | null>(null)
  const [phaseDisplay, setPhaseDisplay] = useState<CallPhaseDisplayState>({
    displayedPhase: 'listening',
    holdUntilMs: 0,
    queue: [],
  })

  const startedRef = useRef(false)
  const connectedAtRef = useRef<number | null>(null)
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Placeholder until the M39 transcript stream is exposed (see CallTranscriptLine).
  const transcriptLines: CallTranscriptLine[] = []

  // Start the call once when the page opens; tear it down if the page unmounts
  // (e.g. swipe-back) so a call never leaks past the modal.
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void startWebRtcTestCall()
    return () => stopWebRtcTestCall()
  }, [startWebRtcTestCall, stopWebRtcTestCall])

  // Begin counting once the call actually connects.
  useEffect(() => {
    if (webRtcTestCall.status === 'connected' && connectedAtRef.current === null) {
      connectedAtRef.current = Date.now()
    }
  }, [webRtcTestCall.status])

  useEffect(() => {
    if (ended || webRtcTestCall.status !== 'connected') return
    const id = setInterval(() => {
      if (connectedAtRef.current !== null) setElapsedMs(Date.now() - connectedAtRef.current)
    }, 1000)
    return () => clearInterval(id)
  }, [ended, webRtcTestCall.status])

  // After hang-up we show a brief "call ended" state, then close the modal.
  useEffect(() => {
    if (!ended) return
    const id = setTimeout(() => router.back(), 4000)
    return () => clearTimeout(id)
  }, [ended, router])

  const callStatePhase = __DEV__ && debugPhase ? debugPhase : webRtcCallPhase
  useEffect(() => {
    if (ended || webRtcTestCall.status !== 'connected') {
      if (phaseTimerRef.current) {
        clearTimeout(phaseTimerRef.current)
        phaseTimerRef.current = null
      }
      setPhaseDisplay({ displayedPhase: 'listening', holdUntilMs: 0, queue: [] })
      return
    }
    setPhaseDisplay((current) =>
      enqueueCallPhaseDisplay(current, callStatePhase, Date.now(), MIN_CALL_PHASE_DWELL_MS)
    )
  }, [callStatePhase, ended, webRtcTestCall.status])

  useEffect(() => {
    if (phaseTimerRef.current) {
      clearTimeout(phaseTimerRef.current)
      phaseTimerRef.current = null
    }
    if (ended || webRtcTestCall.status !== 'connected' || phaseDisplay.queue.length === 0) return
    const delayMs = Math.max(0, phaseDisplay.holdUntilMs - Date.now())
    phaseTimerRef.current = setTimeout(() => {
      phaseTimerRef.current = null
      setPhaseDisplay((current) =>
        advanceCallPhaseDisplay(current, Date.now(), MIN_CALL_PHASE_DWELL_MS)
      )
    }, delayMs)
    return () => {
      if (phaseTimerRef.current) {
        clearTimeout(phaseTimerRef.current)
        phaseTimerRef.current = null
      }
    }
  }, [ended, phaseDisplay, webRtcTestCall.status])

  const displayedCallStatePhase = phaseDisplay.displayedPhase
  const phase = resolveCallPhase({
    callStatePhase: displayedCallStatePhase,
    ended,
    status: webRtcTestCall.status,
  })
  const connected = isConnectedPhase(phase)
  const visual = CALL_VISUALS[phase]

  const hangUp = useCallback(() => {
    stopWebRtcTestCall()
    setEnded(true)
  }, [stopWebRtcTestCall])

  const cancelCall = useCallback(() => {
    stopWebRtcTestCall()
    router.back()
  }, [router, stopWebRtcTestCall])

  const exitCall = useCallback(() => {
    stopWebRtcTestCall()
    router.back()
  }, [router, stopWebRtcTestCall])

  const retryCall = useCallback(() => {
    connectedAtRef.current = null
    setElapsedMs(0)
    setEnded(false)
    void startWebRtcTestCall()
  }, [startWebRtcTestCall])

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev
      setWebRtcCallMuted(next)
      return next
    })
  }, [setWebRtcCallMuted])

  const cycleDebugPhase = useCallback(() => {
    if (!__DEV__) return
    setDebugPhase((current) => {
      const currentIndex = DEBUG_PHASES.indexOf(current ?? callStatePhase)
      return DEBUG_PHASES[(currentIndex + 1) % DEBUG_PHASES.length] ?? 'listening'
    })
  }, [callStatePhase])

  const statusLabel = t(getCallPhaseLabelKey(phase))
  const headline = t(`call.headline.${phase}`)
  const timerText = connected || ended ? formatCallDuration(elapsedMs) : '··:··'
  const errorReason = webRtcTestCall.status === 'error' ? webRtcTestCall.reason : null

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* top: status pill (left) + call timer (right) */}
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
          <Text style={styles.timer}>{timerText}</Text>
        </View>

        {/* center: glowing orb + state headline + sub / barge-in hint */}
        <View style={styles.stage}>
          <Pressable
            disabled={!__DEV__}
            onLongPress={cycleDebugPhase}
            testID="call-orb-debug-cycle"
          >
            <GlowOrb accent={visual.accent} kind={visual.kind} glyphSize={64} size={168}>
              <Ionicons color="#05070a" name={visual.glyph} size={30} />
            </GlowOrb>
          </Pressable>
          <Text style={[styles.headline, { color: visual.soft }]}>{statusLabel}</Text>
          <Text style={styles.phaseCaption}>{headline}</Text>
          {phase === 'listening' ? (
            <View
              style={[
                styles.bargein,
                { backgroundColor: visual.panel, borderColor: hexToRgba(visual.accent, 0.5) },
              ]}
            >
              <View style={[styles.bargeinDot, { backgroundColor: visual.accent }]} />
              <Text style={[styles.bargeinText, { color: visual.accent }]}>
                {t('call.bargein')}
              </Text>
            </View>
          ) : (
            <Text numberOfLines={2} style={styles.sub}>
              {phase === 'error'
                ? (errorReason ?? t('call.error.body'))
                : phase === 'ended'
                  ? t('call.endedDuration', { duration: formatCallDuration(elapsedMs) })
                  : t(`call.sub.${phase}`)}
            </Text>
          )}
        </View>

        {/* rolling transcript (placeholder until M39 partial stream is exposed) */}
        <View style={styles.transcript}>
          {transcriptLines.length === 0 ? (
            <Text style={styles.transcriptEmpty}>{t('call.transcript.empty')}</Text>
          ) : (
            <ScrollView
              contentContainerStyle={styles.transcriptScroll}
              showsVerticalScrollIndicator={false}
            >
              {transcriptLines.map((line) => (
                <Text key={line.id} style={[styles.tline, line.partial && styles.tlinePartial]}>
                  <Text
                    style={[styles.tlineWho, { color: line.who === 'u' ? '#46E6A9' : '#74B8FF' }]}
                  >
                    {line.who === 'u' ? t('call.transcript.you') : t('call.transcript.ai')}{' '}
                  </Text>
                  {line.text}
                </Text>
              ))}
            </ScrollView>
          )}
        </View>

        {/* bottom: controls — mute + hangup (or cancel / retry+exit per phase) */}
        <View style={styles.controls}>
          {phase === 'connecting' ? (
            <ControlButton
              accent="#FF4B4B"
              icon="close"
              label={t('call.control.cancel')}
              onPress={cancelCall}
              testID="call-cancel"
              variant="hangup"
            />
          ) : phase === 'error' ? (
            <>
              <ControlButton
                icon="refresh"
                label={t('call.control.retry')}
                onPress={retryCall}
                testID="call-retry"
              />
              <ControlButton
                accent="#FF4B4B"
                icon="close"
                label={t('call.control.exit')}
                onPress={exitCall}
                testID="call-exit"
                variant="hangup"
              />
            </>
          ) : phase === 'ended' ? null : (
            <>
              <ControlButton
                active={muted}
                icon={muted ? 'mic-off' : 'mic'}
                label={muted ? t('call.control.unmute') : t('call.control.mute')}
                onPress={toggleMute}
                testID="call-mute"
              />
              <ControlButton
                accent="#FF4B4B"
                icon="call"
                label={t('call.control.hangup')}
                onPress={hangUp}
                testID="call-hangup"
                variant="hangup"
              />
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  )
}

function ControlButton({
  accent,
  active = false,
  icon,
  label,
  onPress,
  testID,
  variant = 'default',
}: {
  accent?: string
  active?: boolean
  icon: keyof typeof Ionicons.glyphMap
  label: string
  onPress: () => void
  testID: string
  variant?: 'default' | 'hangup'
}) {
  const hangup = variant === 'hangup'
  return (
    <View style={styles.ctrl}>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        hitSlop={8}
        onPress={onPress}
        style={({ pressed }) => [
          styles.ctrlBtn,
          hangup && [styles.ctrlBtnHangup, accent ? { backgroundColor: accent } : null],
          active && styles.ctrlBtnActive,
          pressed && styles.ctrlBtnPressed,
        ]}
        testID={testID}
      >
        <Ionicons
          color={hangup ? '#ffffff' : active ? '#74B8FF' : '#C9D1D9'}
          name={icon}
          size={hangup ? 30 : 22}
        />
      </Pressable>
      <Text style={styles.ctrlLabel}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  bargein: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 6,
  },
  bargeinDot: {
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  bargeinText: {
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  container: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  controls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 26,
    justifyContent: 'center',
    minHeight: 96,
  },
  ctrl: {
    alignItems: 'center',
    gap: 6,
  },
  ctrlBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 26,
    borderWidth: 1,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  ctrlBtnActive: {
    backgroundColor: 'rgba(116, 184, 255, 0.2)',
    borderColor: 'rgba(116, 184, 255, 0.5)',
  },
  ctrlBtnHangup: {
    backgroundColor: '#FF4B4B',
    borderRadius: 35,
    borderWidth: 0,
    height: 70,
    width: 70,
  },
  ctrlBtnPressed: {
    opacity: 0.7,
  },
  ctrlLabel: {
    color: '#88919d',
    fontSize: 10.5,
    fontWeight: '700',
  },
  headline: {
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 0.3,
    shadowColor: 'rgba(0, 0, 0, 0.45)',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 8,
    textAlign: 'center',
  },
  phaseCaption: {
    color: '#C9D1D9',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginTop: -10,
    textAlign: 'center',
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
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  safeArea: {
    backgroundColor: CALL_BG,
    flex: 1,
  },
  stage: {
    alignItems: 'center',
    flex: 1,
    gap: 18,
    justifyContent: 'center',
  },
  sub: {
    color: '#88919d',
    fontSize: 12.5,
    lineHeight: 19,
    maxWidth: 240,
    textAlign: 'center',
  },
  timer: {
    color: '#c9d0d8',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  tline: {
    color: '#f7f7f2',
    fontSize: 12.5,
    lineHeight: 19,
  },
  tlinePartial: {
    color: '#88919d',
    fontStyle: 'italic',
  },
  tlineWho: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 32,
  },
  transcript: {
    backgroundColor: 'rgba(0, 0, 0, 0.32)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 16,
    borderWidth: 1,
    maxHeight: 122,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  transcriptEmpty: {
    color: '#6e7681',
    fontSize: 12.5,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  transcriptScroll: {
    gap: 7,
  },
})
