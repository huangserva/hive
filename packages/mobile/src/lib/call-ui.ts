// Pure UI helpers for the WebRTC call page (app/call.tsx). Kept out of the .tsx
// so they can be unit-tested without a React Native renderer.

import type { VoiceCallStatePhase } from '../api/voice-call-state-protocol'

export type CallPhase = 'connecting' | VoiceCallStatePhase | 'error' | 'ended'

export type WebRtcCallStatus = 'idle' | 'connecting' | 'connected' | 'error'
export const MIN_CALL_PHASE_DWELL_MS = 900

export interface CallPhaseDisplayState {
  displayedPhase: VoiceCallStatePhase
  holdUntilMs: number
  queue: VoiceCallStatePhase[]
}

const createCallPhaseDisplayState = (
  phase: VoiceCallStatePhase,
  nowMs: number,
  minDwellMs = MIN_CALL_PHASE_DWELL_MS
): CallPhaseDisplayState => ({
  displayedPhase: phase,
  holdUntilMs: phase === 'listening' ? nowMs : nowMs + minDwellMs,
  queue: [],
})

const appendQueuedPhase = (
  queue: VoiceCallStatePhase[],
  displayedPhase: VoiceCallStatePhase,
  nextPhase: VoiceCallStatePhase
) => {
  const lastPhase = queue.at(-1) ?? displayedPhase
  if (lastPhase === nextPhase) return queue
  return [...queue, nextPhase]
}

// Format elapsed call time as mm:ss (clamped at 0).
export const formatCallDuration = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

// Derive the call-page UI phase from the hook status + the page-local `ended`
// flag + the connected sub-state (在听你 ⇄ AI 说话). `ended` wins (it is the
// local post-hangup display state the hook itself does not have); then error;
// then the two connected sub-states; otherwise we are still dialing out.
export const resolveCallPhase = (input: {
  callStatePhase?: VoiceCallStatePhase
  ended: boolean
  status: WebRtcCallStatus
}): CallPhase => {
  if (input.ended) return 'ended'
  if (input.status === 'error') return 'error'
  if (input.status === 'connected') return input.callStatePhase ?? 'listening'
  return 'connecting'
}

export const isConnectedPhase = (phase: CallPhase) =>
  phase === 'listening' || phase === 'heard' || phase === 'processing' || phase === 'responding'

export const enqueueCallPhaseDisplay = (
  state: CallPhaseDisplayState | undefined,
  nextPhase: VoiceCallStatePhase,
  nowMs: number,
  minDwellMs = MIN_CALL_PHASE_DWELL_MS
): CallPhaseDisplayState => {
  if (nextPhase === 'listening') return createCallPhaseDisplayState('listening', nowMs, minDwellMs)
  const current = state ? advanceCallPhaseDisplay(state, nowMs, minDwellMs) : undefined
  if (!current || current.displayedPhase === 'listening') {
    return createCallPhaseDisplayState(nextPhase, nowMs, minDwellMs)
  }
  if (current.displayedPhase === nextPhase) return current
  return {
    ...current,
    queue: appendQueuedPhase(current.queue, current.displayedPhase, nextPhase),
  }
}

export const advanceCallPhaseDisplay = (
  state: CallPhaseDisplayState,
  nowMs: number,
  minDwellMs = MIN_CALL_PHASE_DWELL_MS
): CallPhaseDisplayState => {
  if (state.queue.length === 0 || nowMs < state.holdUntilMs) return state
  const [nextPhase, ...queue] = state.queue
  if (!nextPhase) return state
  return {
    displayedPhase: nextPhase,
    holdUntilMs: nextPhase === 'listening' ? nowMs : nowMs + minDwellMs,
    queue,
  }
}

export const getCallPhaseLabelKey = (phase: CallPhase) => `call.status.${phase}` as const
