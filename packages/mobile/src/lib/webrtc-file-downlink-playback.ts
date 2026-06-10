import type { VoiceCallStatePhase } from '../api/voice-call-state-protocol'
import type { VoiceDownlinkSegmentAudioResult } from '../api/voice-downlink-segment-protocol'

export type WebRtcFileDownlinkPlayer = {
  play: () => void
  replace: (source: { uri: string }) => void
}

export const playWebRtcFileDownlinkSegment = async ({
  player,
  segment,
  setAudioMode,
}: {
  player: WebRtcFileDownlinkPlayer
  segment: Pick<VoiceDownlinkSegmentAudioResult, 'audio' | 'mime'>
  setAudioMode: (mode: { allowsRecording: boolean; playsInSilentMode: boolean }) => Promise<void>
}) => {
  await setAudioMode({
    allowsRecording: false,
    playsInSilentMode: true,
  })
  player.replace({ uri: `data:${segment.mime};base64,${segment.audio}` })
  player.play()
}

export const DEFAULT_WEBRTC_FILE_DOWNLINK_QUIET_GAP_MS = 900

type WebRtcFileDownlinkQueuedSegment = Pick<
  VoiceDownlinkSegmentAudioResult,
  'audio' | 'call_id' | 'format' | 'generation' | 'mime' | 'segment_id' | 'text' | 'turn_id'
>

export const createWebRtcFileDownlinkPlaybackGate = ({
  minQuietGapMs = DEFAULT_WEBRTC_FILE_DOWNLINK_QUIET_GAP_MS,
  now = Date.now,
  onEnqueue,
  onError,
  onPlaybackEnd,
  onPlaybackStart,
  play,
}: {
  minQuietGapMs?: number
  now?: () => number
  onEnqueue?: (input: { pendingCount: number; segment: WebRtcFileDownlinkQueuedSegment }) => void
  onError?: (error: unknown) => void
  onPlaybackEnd?: (segment: WebRtcFileDownlinkQueuedSegment) => void
  onPlaybackStart?: (segment: WebRtcFileDownlinkQueuedSegment) => void
  play: (segment: WebRtcFileDownlinkQueuedSegment) => Promise<void> | void
}) => {
  let currentPhase: VoiceCallStatePhase = 'listening'
  let currentPlayToken: number | null = null
  let currentSegment: WebRtcFileDownlinkQueuedSegment | null = null
  let nextPlayToken = 0
  let playbackInFlight = false
  let quietUntilMs = 0
  let queue: WebRtcFileDownlinkQueuedSegment[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = null
  }

  const phaseAllowsPlayback = () => currentPhase === 'listening' || currentPhase === 'responding'

  const finishPlayback = (playToken: number) => {
    if (!playbackInFlight || currentPlayToken !== playToken) return
    const finishedSegment = currentSegment
    playbackInFlight = false
    currentPlayToken = null
    currentSegment = null
    if (finishedSegment) onPlaybackEnd?.(finishedSegment)
    scheduleStart()
  }

  const scheduleStart = () => {
    clearTimer()
    if (queue.length === 0 || playbackInFlight || !phaseAllowsPlayback()) return
    const delayMs = quietUntilMs - now()
    if (delayMs <= 0) {
      const [segment, ...rest] = queue
      if (!segment) return
      queue = rest
      const playToken = ++nextPlayToken
      currentPlayToken = playToken
      currentSegment = segment
      playbackInFlight = true
      onPlaybackStart?.(segment)
      void Promise.resolve(play(segment)).catch((error) => {
        if (currentPlayToken !== playToken) return
        onError?.(error)
        playbackInFlight = false
        currentPlayToken = null
        currentSegment = null
        scheduleStart()
      })
      return
    }
    timer = setTimeout(() => {
      timer = null
      scheduleStart()
    }, delayMs)
  }

  return {
    clear() {
      clearTimer()
      nextPlayToken += 1
      queue = []
      playbackInFlight = false
      currentPlayToken = null
      currentSegment = null
      quietUntilMs = 0
      currentPhase = 'listening'
    },
    enqueue(segment: WebRtcFileDownlinkQueuedSegment) {
      queue.push(segment)
      onEnqueue?.({ pendingCount: queue.length, segment })
      scheduleStart()
    },
    pendingCount() {
      return queue.length
    },
    onPlaybackEnded(playToken = currentPlayToken) {
      if (playToken === null) return
      finishPlayback(playToken)
    },
    retract(callId: string, retractGeneration: number) {
      queue = queue.filter(
        (segment) => segment.call_id !== callId || segment.generation > retractGeneration
      )
      scheduleStart()
    },
    updatePhase(phase: VoiceCallStatePhase) {
      currentPhase = phase
      if (phase === 'heard' || phase === 'processing') {
        quietUntilMs = Math.max(quietUntilMs, now() + minQuietGapMs)
      }
      scheduleStart()
    },
  }
}
