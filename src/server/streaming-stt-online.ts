import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type StreamingParaformerModel = {
  decoder: string
  encoder: string
  tokens: string
}

type OnlineRecognizerStream = {
  acceptWaveform?: (sampleRate: number, samples: Float32Array) => void
  free?: () => void
  inputFinished?: () => void
}

type OnlineRecognizer = {
  createStream(): OnlineRecognizerStream
  decode(stream: OnlineRecognizerStream): void
  free?: () => void
  getResult(stream: OnlineRecognizerStream): { text?: string } | string | null
  isEndpoint(stream: OnlineRecognizerStream): boolean
  isReady(stream: OnlineRecognizerStream): boolean
  reset(stream: OnlineRecognizerStream): void
}

type SherpaOnnxOnlineRuntime = {
  createOnlineRecognizer?: (config: unknown) => OnlineRecognizer
}

type StreamingRecognitionDependencies = {
  env?: NodeJS.ProcessEnv
  loadSherpaOnnx?: () => Promise<SherpaOnnxOnlineRuntime>
}

export type StreamingRecognitionSession = {
  close(): void
  flush(): Promise<void>
  pushFrame(pcmBuffer: Buffer, sampleRate: number, bitsPerSample: number): void
}

export type StreamingRecognitionOptions = {
  onError?: (error: unknown) => void
  onFinal: (text: string) => Promise<void>
  onPartial?: (text: string) => void
}

type RecognizerCacheEntry = {
  activeStreams: number
  freeWhenIdle: boolean
  freed: boolean
  key: string
  recognizer: OnlineRecognizer
}

type RecognizerLease = {
  recognizer: OnlineRecognizer
  release: () => void
}

let recognizerCache: RecognizerCacheEntry | null = null
const recognizerLoads = new Map<string, Promise<RecognizerCacheEntry>>()

const extractResultText = (result: { text?: string } | string | null) => {
  if (typeof result === 'string') return result.trim()
  return (result?.text ?? '').trim()
}

const loadSherpaOnnxRuntime = async (): Promise<SherpaOnnxOnlineRuntime> => {
  const moduleName = 'sherpa-onnx'
  return (await import(moduleName)) as SherpaOnnxOnlineRuntime
}

export const __resetStreamingRecognizerCacheForTests = () => {
  if (recognizerCache && !recognizerCache.freed) {
    recognizerCache.freed = true
    recognizerCache.recognizer.free?.()
  }
  recognizerCache = null
  for (const load of recognizerLoads.values()) {
    load.then(
      (entry) => {
        if (!entry.freed) {
          entry.freed = true
          entry.recognizer.free?.()
        }
      },
      () => {}
    )
  }
  recognizerLoads.clear()
}

export const resolveStreamingParaformerModel = (
  env: NodeJS.ProcessEnv = process.env
): StreamingParaformerModel | null => {
  const baseDir = env.HIVE_STREAMING_PARAFORMER_DIR
    ? env.HIVE_STREAMING_PARAFORMER_DIR
    : join(env.HOME ?? homedir(), '.config', 'hive', 'streaming-paraformer')
  const model = {
    decoder: join(baseDir, 'decoder.int8.onnx'),
    encoder: join(baseDir, 'encoder.int8.onnx'),
    tokens: join(baseDir, 'tokens.txt'),
  }
  return existsSync(model.encoder) && existsSync(model.decoder) && existsSync(model.tokens)
    ? model
    : null
}

export const resampleInt16PcmTo16kFloat32 = (
  pcmBuffer: Buffer,
  sampleRate: number,
  bitsPerSample: number
) => {
  if (bitsPerSample !== 16 || sampleRate <= 0 || pcmBuffer.byteLength < 2) {
    return new Float32Array()
  }
  const sampleCount = Math.floor(pcmBuffer.byteLength / 2)
  const step = sampleRate / 16_000
  const outputLength = Math.max(1, Math.floor(sampleCount / step))
  const output = new Float32Array(outputLength)
  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = Math.min(sampleCount - 1, Math.floor(index * step))
    output[index] = Math.max(-1, Math.min(1, pcmBuffer.readInt16LE(sourceIndex * 2) / 32768))
  }
  return output
}

const releaseRecognizer = (entry: RecognizerCacheEntry) => {
  entry.activeStreams = Math.max(0, entry.activeStreams - 1)
  if (entry.freeWhenIdle && entry.activeStreams === 0 && !entry.freed) {
    entry.freed = true
    entry.recognizer.free?.()
  }
}

const retireRecognizer = (entry: RecognizerCacheEntry) => {
  entry.freeWhenIdle = true
  if (entry.activeStreams === 0 && !entry.freed) {
    entry.freed = true
    entry.recognizer.free?.()
  }
}

const leaseRecognizer = (entry: RecognizerCacheEntry): RecognizerLease => {
  entry.activeStreams += 1
  return {
    recognizer: entry.recognizer,
    release: () => releaseRecognizer(entry),
  }
}

const acquireRecognizer = async (
  model: StreamingParaformerModel,
  dependencies: StreamingRecognitionDependencies
) => {
  const key = `${model.encoder}\0${model.decoder}\0${model.tokens}`
  if (recognizerCache?.key === key) return leaseRecognizer(recognizerCache)
  const existingLoad = recognizerLoads.get(key)
  if (existingLoad) return leaseRecognizer(await existingLoad)
  const load = (async () => {
    const runtime = await (dependencies.loadSherpaOnnx ?? loadSherpaOnnxRuntime)()
    if (!runtime.createOnlineRecognizer) {
      throw new Error('sherpa-onnx online recognizer is unavailable')
    }
    const recognizer = runtime.createOnlineRecognizer({
      decodingMethod: 'greedy_search',
      enableEndpoint: true,
      featConfig: { featureDim: 80, sampleRate: 16_000 },
      maxActivePaths: 4,
      modelConfig: {
        debug: false,
        numThreads: 2,
        paraformer: {
          decoder: model.decoder,
          encoder: model.encoder,
        },
        provider: 'cpu',
        tokens: model.tokens,
      },
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 1.2,
      rule3MinUtteranceLength: 20.0,
    })
    const entry = {
      activeStreams: 0,
      freeWhenIdle: false,
      freed: false,
      key,
      recognizer,
    }
    if (recognizerCache && recognizerCache.key !== key) retireRecognizer(recognizerCache)
    recognizerCache = entry
    return entry
  })()
  recognizerLoads.set(key, load)
  try {
    return leaseRecognizer(await load)
  } finally {
    recognizerLoads.delete(key)
  }
}

export const createStreamingRecognitionSession = async (
  callId: string,
  options: StreamingRecognitionOptions,
  dependencies: StreamingRecognitionDependencies = {}
): Promise<StreamingRecognitionSession | null> => {
  const model = resolveStreamingParaformerModel(dependencies.env)
  if (!model) return null
  let lease: RecognizerLease
  try {
    lease = await acquireRecognizer(model, dependencies)
  } catch (error) {
    options.onError?.(error)
    return null
  }
  const recognizer = lease.recognizer
  const stream = recognizer.createStream()
  let closed = false
  let lastPartialText = ''
  let finalQueue = Promise.resolve()

  const emitFinal = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    finalQueue = finalQueue
      .then(() => options.onFinal(trimmed))
      .catch((error) => options.onError?.(error))
  }

  const resetStream = () => {
    recognizer.reset(stream)
    lastPartialText = ''
  }

  const drainReadyFrames = () => {
    while (recognizer.isReady(stream)) {
      recognizer.decode(stream)
    }
  }

  return {
    close() {
      if (closed) return
      closed = true
      stream.free?.()
      lease.release()
    },
    async flush() {
      if (closed) return
      stream.inputFinished?.()
      drainReadyFrames()
      const text = extractResultText(recognizer.getResult(stream))
      emitFinal(text)
      if (text) resetStream()
      await finalQueue
    },
    pushFrame(pcmBuffer, sampleRate, bitsPerSample) {
      if (closed) return
      try {
        const samples = resampleInt16PcmTo16kFloat32(pcmBuffer, sampleRate, bitsPerSample)
        if (samples.length === 0) return
        stream.acceptWaveform?.(16_000, samples)
        drainReadyFrames()
        const text = extractResultText(recognizer.getResult(stream))
        if (text && text !== lastPartialText) {
          lastPartialText = text
          options.onPartial?.(text)
        }
        if (recognizer.isEndpoint(stream)) {
          emitFinal(text)
          resetStream()
        }
      } catch (error) {
        options.onError?.({ callId, error })
        throw error
      }
    },
  }
}
