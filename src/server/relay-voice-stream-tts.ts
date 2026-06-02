import { createLocalTtsProvider, type LocalTtsProvider } from './local-tts.js'
import type { VoiceStreamFrame } from './relay-connector.js'

interface VoiceStreamTtsHandlerOptions {
  chunkSize?: number
  createTtsProvider?: () => LocalTtsProvider
}

export type VoiceStreamSendContext = {
  capabilities: string[]
  deviceId: string
  send: (frame: VoiceStreamFrame) => void
}

const DEFAULT_AUDIO_CHUNK_CHARS = 8 * 1024

const splitBase64 = (base64: string, chunkSize: number) => {
  if (chunkSize <= 0) throw new Error('chunkSize must be positive')
  const alignedChunkSize = Math.max(4, chunkSize - (chunkSize % 4))
  const chunks: string[] = []
  if (!base64) return ['']
  for (let offset = 0; offset < base64.length; offset += alignedChunkSize) {
    chunks.push(base64.slice(offset, offset + alignedChunkSize))
  }
  return chunks
}

export const createVoiceStreamTtsHandler = (options: VoiceStreamTtsHandlerOptions = {}) => {
  const chunkSize = options.chunkSize ?? DEFAULT_AUDIO_CHUNK_CHARS
  const createTtsProvider = options.createTtsProvider ?? createLocalTtsProvider

  return async (frame: VoiceStreamFrame, context: VoiceStreamSendContext) => {
    if (frame.op !== 'open' || typeof frame.text !== 'string' || !frame.text.trim()) {
      return false
    }
    const streamId = frame.stream_id
    const openSeq = frame.seq
    if (typeof streamId !== 'string' || typeof openSeq !== 'number') return false
    if (!context.capabilities.includes('send_prompt')) {
      context.send({
        error: 'missing_mobile_capability: send_prompt',
        op: 'error',
        seq: openSeq,
        stream_id: streamId,
        type: 'voice_stream',
      })
      return true
    }

    const provider = createTtsProvider()
    const cli = await provider.detect()
    if (!cli) {
      context.send({
        error: 'tts_unavailable',
        op: 'error',
        seq: openSeq,
        stream_id: streamId,
        type: 'voice_stream',
      })
      return true
    }
    const result = await provider.synthesize(frame.text)
    if (!result) {
      context.send({
        error: 'synthesis_failed',
        op: 'error',
        seq: openSeq,
        stream_id: streamId,
        type: 'voice_stream',
      })
      return true
    }

    const chunks = splitBase64(result.audio.toString('base64'), chunkSize)
    chunks.forEach((chunk, index) => {
      context.send({
        done: index === chunks.length - 1,
        format: result.format,
        mime: result.mime,
        op: 'chunk',
        payload: chunk,
        seq: openSeq + index + 1,
        stream_id: streamId,
        type: 'voice_stream',
      })
    })
    return true
  }
}
