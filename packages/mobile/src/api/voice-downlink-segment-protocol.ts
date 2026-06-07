export type VoiceDownlinkSegmentOperation =
  | 'interrupt'
  | 'retract'
  | 'segment_chunk'
  | 'segment_open'

export interface VoiceDownlinkSegmentFrame {
  call_id: string
  done?: boolean
  error?: string
  format?: string
  generation: number
  is_final?: boolean
  mime?: string
  op: VoiceDownlinkSegmentOperation
  payload?: string
  retract_generation?: number
  segment_id: number
  seq: number
  text?: string
  turn_id: string
  type: 'voice_downlink_segment'
}

export interface VoiceDownlinkSegmentAudioResult {
  audio: string
  call_id: string
  format: string
  generation: number
  is_final: boolean
  mime: string
  segment_id: number
  text?: string
  turn_id: string
}

const OPERATIONS = new Set<VoiceDownlinkSegmentOperation>([
  'interrupt',
  'retract',
  'segment_chunk',
  'segment_open',
])

export const isVoiceDownlinkSegmentFrame = (value: unknown): value is VoiceDownlinkSegmentFrame => {
  if (typeof value !== 'object' || value === null) return false
  const frame = value as Partial<VoiceDownlinkSegmentFrame>
  const hasValidRetractGeneration =
    frame.op !== 'retract' ||
    (typeof frame.retract_generation === 'number' &&
      Number.isInteger(frame.retract_generation) &&
      frame.retract_generation >= 0)
  return (
    frame.type === 'voice_downlink_segment' &&
    typeof frame.call_id === 'string' &&
    frame.call_id.length > 0 &&
    typeof frame.turn_id === 'string' &&
    frame.turn_id.length > 0 &&
    typeof frame.segment_id === 'number' &&
    Number.isInteger(frame.segment_id) &&
    frame.segment_id >= 0 &&
    typeof frame.generation === 'number' &&
    Number.isInteger(frame.generation) &&
    frame.generation >= 0 &&
    typeof frame.seq === 'number' &&
    Number.isInteger(frame.seq) &&
    frame.seq >= 0 &&
    typeof frame.op === 'string' &&
    OPERATIONS.has(frame.op as VoiceDownlinkSegmentOperation) &&
    hasValidRetractGeneration
  )
}

export const createVoiceDownlinkSegmentFrame = (
  op: VoiceDownlinkSegmentOperation,
  input: {
    callId: string
    done?: boolean
    format?: string
    generation: number
    isFinal?: boolean
    mime?: string
    payload?: string
    retractGeneration?: number
    segmentId: number
    seq: number
    text?: string
    turnId: string
  }
): VoiceDownlinkSegmentFrame => ({
  ...(input.done !== undefined ? { done: input.done } : {}),
  ...(input.format !== undefined ? { format: input.format } : {}),
  ...(input.isFinal !== undefined ? { is_final: input.isFinal } : {}),
  ...(input.mime !== undefined ? { mime: input.mime } : {}),
  ...(input.payload !== undefined ? { payload: input.payload } : {}),
  ...(input.retractGeneration !== undefined ? { retract_generation: input.retractGeneration } : {}),
  ...(input.text !== undefined ? { text: input.text } : {}),
  call_id: input.callId,
  generation: input.generation,
  op,
  segment_id: input.segmentId,
  seq: input.seq,
  turn_id: input.turnId,
  type: 'voice_downlink_segment',
})

export const createVoiceDownlinkSegmentReassembler = ({
  callId,
  generation,
  segmentId,
  turnId,
}: {
  callId: string
  generation: number
  segmentId: number
  turnId: string
}) => {
  const chunks = new Map<number, string>()
  let doneSeq: number | null = null
  let format = 'm4a'
  let isFinal = false
  let mime = 'audio/mp4'
  let text: string | undefined

  const tryBuild = (): VoiceDownlinkSegmentAudioResult | null => {
    if (doneSeq === null) return null
    const ordered: string[] = []
    for (let seq = 1; seq <= doneSeq; seq += 1) {
      const chunk = chunks.get(seq)
      if (chunk === undefined) return null
      ordered.push(chunk)
    }
    return {
      ...(text !== undefined ? { text } : {}),
      audio: ordered.join(''),
      call_id: callId,
      format,
      generation,
      is_final: isFinal,
      mime,
      segment_id: segmentId,
      turn_id: turnId,
    }
  }

  return {
    accept(frame: VoiceDownlinkSegmentFrame): VoiceDownlinkSegmentAudioResult | null {
      if (
        frame.type !== 'voice_downlink_segment' ||
        frame.call_id !== callId ||
        frame.turn_id !== turnId ||
        frame.segment_id !== segmentId ||
        frame.generation !== generation
      ) {
        return null
      }
      if (frame.format) format = frame.format
      if (frame.is_final !== undefined) isFinal = frame.is_final
      if (frame.mime) mime = frame.mime
      if (frame.text !== undefined) text = frame.text
      if (frame.op !== 'segment_chunk') return null
      if (typeof frame.payload !== 'string') return null
      chunks.set(frame.seq, frame.payload)
      if (frame.done) doneSeq = frame.seq
      return tryBuild()
    },
  }
}

type VoiceDownlinkSegmentReassembler = ReturnType<typeof createVoiceDownlinkSegmentReassembler>

interface VoiceDownlinkSegmentReassemblerCacheOptions {
  maxEntries?: number
  ttlMs?: number
}

const DEFAULT_REASSEMBLER_CACHE_MAX_ENTRIES = 32
const DEFAULT_REASSEMBLER_CACHE_TTL_MS = 30_000

const cacheKeyForFrame = (frame: VoiceDownlinkSegmentFrame) =>
  `${frame.call_id}:${frame.turn_id}:${frame.segment_id}:${frame.generation}`

export const createVoiceDownlinkSegmentReassemblerCache = ({
  maxEntries = DEFAULT_REASSEMBLER_CACHE_MAX_ENTRIES,
  ttlMs = DEFAULT_REASSEMBLER_CACHE_TTL_MS,
}: VoiceDownlinkSegmentReassemblerCacheOptions = {}) => {
  const entries = new Map<
    string,
    {
      createdAtMs: number
      frame: Pick<VoiceDownlinkSegmentFrame, 'call_id' | 'generation'>
      reassembler: VoiceDownlinkSegmentReassembler
      updatedAtMs: number
    }
  >()
  const retractedGenerationByCall = new Map<string, number>()

  const cleanup = (nowMs = Date.now()) => {
    for (const [key, entry] of entries) {
      if (nowMs - entry.updatedAtMs > ttlMs) entries.delete(key)
    }
    while (entries.size > maxEntries) {
      const oldest = [...entries.entries()].sort((a, b) => a[1].updatedAtMs - b[1].updatedAtMs)[0]
      if (!oldest) break
      entries.delete(oldest[0])
    }
  }

  const clearOlderGenerations = (frame: VoiceDownlinkSegmentFrame) => {
    for (const [key, entry] of entries) {
      if (entry.frame.call_id === frame.call_id && entry.frame.generation < frame.generation) {
        entries.delete(key)
      }
    }
  }

  const clearRetractedGenerations = (callId: string, retractGeneration: number) => {
    const previous = retractedGenerationByCall.get(callId)
    retractedGenerationByCall.set(
      callId,
      previous === undefined ? retractGeneration : Math.max(previous, retractGeneration)
    )
    for (const [key, entry] of entries) {
      if (entry.frame.call_id === callId && entry.frame.generation <= retractGeneration) {
        entries.delete(key)
      }
    }
  }

  return {
    accept(
      frame: VoiceDownlinkSegmentFrame,
      nowMs = Date.now()
    ): VoiceDownlinkSegmentAudioResult | null {
      cleanup(nowMs)
      const retractedGeneration = retractedGenerationByCall.get(frame.call_id)
      if (retractedGeneration !== undefined && frame.generation <= retractedGeneration) {
        return null
      }
      clearOlderGenerations(frame)
      const key = cacheKeyForFrame(frame)
      let entry = entries.get(key)
      if (!entry) {
        entry = {
          createdAtMs: nowMs,
          frame: { call_id: frame.call_id, generation: frame.generation },
          reassembler: createVoiceDownlinkSegmentReassembler({
            callId: frame.call_id,
            generation: frame.generation,
            segmentId: frame.segment_id,
            turnId: frame.turn_id,
          }),
          updatedAtMs: nowMs,
        }
        entries.set(key, entry)
      }
      entry.updatedAtMs = nowMs
      const result = entry.reassembler.accept(frame)
      if (result) entries.delete(key)
      cleanup(nowMs)
      return result
    },
    cleanup,
    clear() {
      entries.clear()
      retractedGenerationByCall.clear()
    },
    clearRetractedGenerations,
    size() {
      return entries.size
    },
  }
}
