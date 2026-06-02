export type VoiceStreamOperation = 'ack' | 'chunk' | 'close' | 'error' | 'open'

export interface VoiceStreamFrame {
  done?: boolean
  error?: string
  format?: string
  mime?: string
  op: VoiceStreamOperation
  payload?: string
  sent_at_ms?: number
  seq: number
  stream_id: string
  text?: string
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

export const splitAudioBase64ToVoiceStreamFrames = ({
  chunkSize,
  format,
  mime,
  payload,
  startSeq = 1,
  streamId,
}: {
  chunkSize: number
  format: string
  mime: string
  payload: string
  startSeq?: number
  streamId: string
}): VoiceStreamFrame[] => {
  if (chunkSize <= 0) throw new Error('chunkSize must be positive')
  if (!payload) {
    return [
      createVoiceStreamFrame('chunk', streamId, startSeq, {
        done: true,
        format,
        mime,
        payload: '',
      }),
    ]
  }
  const frames: VoiceStreamFrame[] = []
  for (let offset = 0; offset < payload.length; offset += chunkSize) {
    frames.push(
      createVoiceStreamFrame('chunk', streamId, startSeq + frames.length, {
        done: offset + chunkSize >= payload.length,
        format,
        mime,
        payload: payload.slice(offset, offset + chunkSize),
      })
    )
  }
  return frames
}

export interface VoiceStreamAudioResult {
  audio: string
  format: string
  mime: string
  stream_id: string
}

export const createVoiceStreamReassembler = (streamId: string, startSeq = 0) => {
  const chunks = new Map<number, string>()
  let doneSeq: number | null = null
  let format = 'm4a'
  let mime = 'audio/mp4'

  const tryBuild = (): VoiceStreamAudioResult | null => {
    if (doneSeq === null) return null
    const ordered: string[] = []
    for (let seq = startSeq; seq <= doneSeq; seq++) {
      const payload = chunks.get(seq)
      if (payload === undefined) return null
      ordered.push(payload)
    }
    return {
      audio: ordered.join(''),
      format,
      mime,
      stream_id: streamId,
    }
  }

  return {
    accept(frame: VoiceStreamFrame): VoiceStreamAudioResult | null {
      if (frame.type !== 'voice_stream' || frame.op !== 'chunk') return null
      if (frame.stream_id !== streamId) return null
      if (typeof frame.payload !== 'string') return null
      chunks.set(frame.seq, frame.payload)
      if (frame.mime) mime = frame.mime
      if (frame.format) format = frame.format
      if (frame.done) doneSeq = frame.seq
      return tryBuild()
    },
  }
}
