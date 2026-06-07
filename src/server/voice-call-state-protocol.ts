export type VoiceCallStatePhase = 'heard' | 'listening' | 'processing' | 'responding'

export interface VoiceCallStateFrame {
  call_id: string
  phase: VoiceCallStatePhase
  ts: number
  turn_id: string
  type: 'voice_call_state'
}

const PHASES = new Set<VoiceCallStatePhase>(['heard', 'listening', 'processing', 'responding'])
const DEFAULT_VOICE_CALL_STATE_WATCHDOG_MS = 30_000

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

const parsePositiveInteger = (value: unknown) => {
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

type VoiceCallStateLogger = {
  info?: (message: string) => void
}

export const resolveVoiceCallStateWatchdogMs = (
  env: Record<string, unknown> = process.env
): number =>
  parsePositiveInteger(env.HIVE_VOICE_CALL_STATE_WATCHDOG_MS) ??
  DEFAULT_VOICE_CALL_STATE_WATCHDOG_MS

export const createVoiceCallStateSender = <TFrame>(input: {
  callId: string
  logger?: VoiceCallStateLogger | undefined
  send: (frame: TFrame | VoiceCallStateFrame) => void
  watchdogMs?: number
}) => {
  let closed = false
  const sentCallStates = new Set<string>()
  const watchdogs = new Map<string, ReturnType<typeof setTimeout>>()
  const watchdogMs = input.watchdogMs ?? resolveVoiceCallStateWatchdogMs()

  const clearWatchdog = (turnId: string) => {
    const timer = watchdogs.get(turnId)
    if (!timer) return
    clearTimeout(timer)
    watchdogs.delete(turnId)
  }

  const logSentState = (frame: VoiceCallStateFrame, reason?: string) => {
    input.logger?.info?.(
      [
        'voice call state sent:',
        `call_id=${frame.call_id}`,
        `turn_id=${frame.turn_id}`,
        `phase=${frame.phase}`,
        `at=${frame.ts}`,
        ...(reason ? [`reason=${reason}`] : []),
      ].join(' ')
    )
  }

  const sendListening = (turnId: string) => {
    send(createVoiceCallStateFrame({ callId: input.callId, phase: 'listening', turnId }), {
      reason: 'watchdog',
    })
  }

  const startWatchdog = (turnId: string) => {
    clearWatchdog(turnId)
    if (watchdogMs <= 0) return
    const timer = setTimeout(() => {
      watchdogs.delete(turnId)
      sendListening(turnId)
    }, watchdogMs)
    watchdogs.set(turnId, timer)
  }

  const send = (frame: TFrame | VoiceCallStateFrame, metadata?: { reason?: string }) => {
    if (closed) return
    if (!isVoiceCallStateFrame(frame)) {
      input.send(frame)
      return
    }
    if (frame.call_id !== input.callId) {
      input.send(frame)
      return
    }
    const key = `${frame.turn_id}:${frame.phase}`
    if (sentCallStates.has(key)) return
    sentCallStates.add(key)
    if (frame.phase === 'processing') startWatchdog(frame.turn_id)
    if (frame.phase === 'responding' || frame.phase === 'listening') clearWatchdog(frame.turn_id)
    logSentState(frame, metadata?.reason)
    input.send(frame)
  }

  const close = () => {
    closed = true
    for (const timer of watchdogs.values()) clearTimeout(timer)
    watchdogs.clear()
  }

  return { close, send }
}
