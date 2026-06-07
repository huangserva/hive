export type VoiceCallStatePhase = 'heard' | 'listening' | 'processing' | 'responding'

export interface VoiceCallStateFrame {
  call_id: string
  phase: VoiceCallStatePhase
  ts: number
  turn_id: string
  type: 'voice_call_state'
}

const PHASES = new Set<VoiceCallStatePhase>(['heard', 'listening', 'processing', 'responding'])

export const isVoiceCallStateFrame = (value: unknown): value is VoiceCallStateFrame => {
  if (typeof value !== 'object' || value === null) return false
  const frame = value as Partial<VoiceCallStateFrame>
  return (
    frame.type === 'voice_call_state' &&
    typeof frame.call_id === 'string' &&
    frame.call_id.length > 0 &&
    typeof frame.turn_id === 'string' &&
    frame.turn_id.length > 0 &&
    typeof frame.phase === 'string' &&
    PHASES.has(frame.phase as VoiceCallStatePhase) &&
    typeof frame.ts === 'number' &&
    Number.isFinite(frame.ts)
  )
}

export const createVoiceCallStateFrame = (input: {
  callId: string
  phase: VoiceCallStatePhase
  ts?: number
  turnId: string
}): VoiceCallStateFrame => ({
  call_id: input.callId,
  phase: input.phase,
  ts: input.ts ?? Date.now(),
  turn_id: input.turnId,
  type: 'voice_call_state',
})
