export type VoiceStreamOperation = 'ack' | 'chunk' | 'close' | 'error' | 'open'

export interface VoiceStreamFrame {
  error?: string
  op: VoiceStreamOperation
  payload?: string
  sent_at_ms?: number
  seq: number
  stream_id: string
  type: 'voice_stream'
}

export interface VoiceStreamLatencyOptions {
  count?: number
  intervalMs?: number
  timeoutMs?: number
}

export interface VoiceStreamLatencyResult {
  count: number
  lost: number
  max_ms: number
  p50_ms: number
  p95_ms: number
  received: number
  stream_id: string
}

let streamCounter = 0

const VOICE_STREAM_OPERATIONS = new Set<VoiceStreamOperation>([
  'ack',
  'chunk',
  'close',
  'error',
  'open',
])

export const nextVoiceStreamId = (nowMs = Date.now()) => `voice-${nowMs}-${streamCounter++}`

export const isVoiceStreamFrame = (value: unknown): value is VoiceStreamFrame => {
  if (typeof value !== 'object' || value === null) return false
  const frame = value as Partial<VoiceStreamFrame>
  return (
    frame.type === 'voice_stream' &&
    typeof frame.stream_id === 'string' &&
    frame.stream_id.length > 0 &&
    typeof frame.seq === 'number' &&
    Number.isInteger(frame.seq) &&
    frame.seq >= 0 &&
    typeof frame.op === 'string' &&
    VOICE_STREAM_OPERATIONS.has(frame.op as VoiceStreamOperation)
  )
}

export const createVoiceStreamFrame = (
  op: VoiceStreamOperation,
  streamId: string,
  seq: number,
  extras: Omit<Partial<VoiceStreamFrame>, 'op' | 'seq' | 'stream_id' | 'type'> = {}
): VoiceStreamFrame => ({
  ...extras,
  op,
  seq,
  stream_id: streamId,
  type: 'voice_stream',
})

const percentile = (sorted: number[], p: number) => {
  if (sorted.length === 0) return 0
  const index = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.min(Math.max(index, 0), sorted.length - 1)]
}

export const calculateVoiceStreamLatency = ({
  expectedCount,
  rtts,
  streamId,
}: {
  expectedCount: number
  rtts: number[]
  streamId: string
}): VoiceStreamLatencyResult => {
  const sorted = [...rtts].sort((a, b) => a - b)
  return {
    count: expectedCount,
    lost: Math.max(expectedCount - sorted.length, 0),
    max_ms: sorted.at(-1) ?? 0,
    p50_ms: percentile(sorted, 50),
    p95_ms: percentile(sorted, 95),
    received: sorted.length,
    stream_id: streamId,
  }
}
