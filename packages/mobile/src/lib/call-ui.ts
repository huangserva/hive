// Pure UI helpers for the WebRTC call page (app/call.tsx). Kept out of the .tsx
// so they can be unit-tested without a React Native renderer.

import type { VoiceCallStatePhase } from '../api/voice-call-state-protocol'

export type CallPhase = 'connecting' | VoiceCallStatePhase | 'error' | 'ended'

export type WebRtcCallStatus = 'idle' | 'connecting' | 'connected' | 'error'

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
