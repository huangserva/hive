export type NeuralVadPcmProbeEncoding = 'float32' | 'int16'

export type NeuralVadPcmProbeBuffer = {
  channels: number
  data: ArrayBuffer
  sampleRate: number
  timestamp: number
}

export type PcmProbeLogState = {
  framesSinceLastLog: number
  lastLogAtMs: number | null
}

export const PCM_PROBE_LOG_INTERVAL_MS = 1000
export const SILERO_MODEL_CONTEXT_SAMPLE_COUNT = 64
export const SILERO_SHADOW_FRAME_SAMPLE_COUNT = 512

export const createInitialPcmProbeLogState = (): PcmProbeLogState => ({
  framesSinceLastLog: 0,
  lastLogAtMs: null,
})

export type SileroShadowFrame = {
  index: number
  rms: number
  samples: Float32Array
}

export type SileroShadowFrameState = {
  nextFrameIndex: number
  pendingSamples: Float32Array
}

export const createInitialSileroShadowFrameState = (): SileroShadowFrameState => ({
  nextFrameIndex: 1,
  pendingSamples: new Float32Array(0),
})

export type SileroModelState = {
  context: Float32Array
}

export const createInitialSileroModelState = (): SileroModelState => ({
  context: new Float32Array(SILERO_MODEL_CONTEXT_SAMPLE_COUNT),
})

export const resolveNeuralVadPcmProbeEnabled = (env: Record<string, string | undefined>) => {
  const value = env.EXPO_PUBLIC_NEURAL_VAD_PCM_PROBE
  return value === '1' || value === 'true'
}

export const resolveNeuralVadShadowEnabled = (env: Record<string, string | undefined>) => {
  const value = env.EXPO_PUBLIC_NEURAL_VAD_SHADOW
  return value === '1' || value === 'true'
}

const countSamples = (buffer: NeuralVadPcmProbeBuffer, encoding: NeuralVadPcmProbeEncoding) =>
  Math.floor(
    buffer.data.byteLength /
      (encoding === 'int16' ? Int16Array.BYTES_PER_ELEMENT : Float32Array.BYTES_PER_ELEMENT)
  )

const calculateRmsEnergy = (
  buffer: NeuralVadPcmProbeBuffer,
  encoding: NeuralVadPcmProbeEncoding
) => {
  const sampleCount = countSamples(buffer, encoding)
  if (sampleCount <= 0) return 0

  let sumSquares = 0
  if (encoding === 'int16') {
    const samples = new Int16Array(buffer.data)
    for (const sample of samples) {
      const normalized = sample / 32768
      sumSquares += normalized * normalized
    }
  } else {
    const samples = new Float32Array(buffer.data)
    for (const sample of samples) {
      sumSquares += sample * sample
    }
  }
  return Math.sqrt(sumSquares / sampleCount)
}

const calculateFloat32Rms = (samples: Float32Array) => {
  if (samples.length <= 0) return 0
  let sumSquares = 0
  for (const sample of samples) {
    sumSquares += sample * sample
  }
  return Math.sqrt(sumSquares / samples.length)
}

const int16BufferToFloat32 = (buffer: ArrayBuffer) => {
  const samples = new Int16Array(buffer)
  const normalized = new Float32Array(samples.length)
  for (let index = 0; index < samples.length; index += 1) {
    normalized[index] = (samples[index] ?? 0) / 32768
  }
  return normalized
}

const concatenateFloat32 = (left: Float32Array, right: Float32Array) => {
  if (left.length === 0) return right
  if (right.length === 0) return left
  const combined = new Float32Array(left.length + right.length)
  combined.set(left, 0)
  combined.set(right, left.length)
  return combined
}

export const extractSileroShadowFrames = (
  state: SileroShadowFrameState,
  buffer: ArrayBuffer
): { frames: SileroShadowFrame[]; state: SileroShadowFrameState } => {
  const samples = concatenateFloat32(state.pendingSamples, int16BufferToFloat32(buffer))
  const frames: SileroShadowFrame[] = []
  let offset = 0
  let nextFrameIndex = state.nextFrameIndex

  while (offset + SILERO_SHADOW_FRAME_SAMPLE_COUNT <= samples.length) {
    const frameSamples = samples.slice(offset, offset + SILERO_SHADOW_FRAME_SAMPLE_COUNT)
    frames.push({
      index: nextFrameIndex,
      rms: calculateFloat32Rms(frameSamples),
      samples: frameSamples,
    })
    nextFrameIndex += 1
    offset += SILERO_SHADOW_FRAME_SAMPLE_COUNT
  }

  return {
    frames,
    state: {
      nextFrameIndex,
      pendingSamples: samples.slice(offset),
    },
  }
}

export const buildSileroModelInput = (
  state: SileroModelState,
  frame: Float32Array
): { samples: Float32Array; state: SileroModelState } => {
  const samples = new Float32Array(SILERO_MODEL_CONTEXT_SAMPLE_COUNT + frame.length)
  samples.set(state.context, 0)
  samples.set(frame, SILERO_MODEL_CONTEXT_SAMPLE_COUNT)

  return {
    samples,
    state: {
      context: frame.slice(frame.length - SILERO_MODEL_CONTEXT_SAMPLE_COUNT),
    },
  }
}

export const buildSileroShadowLogLine = (result: {
  frameIndex: number
  probability: number
  rms: number
  sampleRate: number
}) =>
  `[SILERODBG] voice_prob=${result.probability.toFixed(3)} frame=${result.frameIndex} rms=${result.rms.toFixed(3)} sr=${result.sampleRate}Hz`

export const buildPcmProbeLogLine = (
  state: PcmProbeLogState,
  buffer: NeuralVadPcmProbeBuffer,
  options: {
    encoding: NeuralVadPcmProbeEncoding
    nowMs: number
  }
): { line: string | null; state: PcmProbeLogState } => {
  const framesSinceLastLog = state.framesSinceLastLog + 1
  const elapsedMs = state.lastLogAtMs === null ? null : options.nowMs - state.lastLogAtMs
  const shouldLog =
    state.lastLogAtMs === null || (elapsedMs !== null && elapsedMs >= PCM_PROBE_LOG_INTERVAL_MS)
  if (!shouldLog) {
    return {
      line: null,
      state: { ...state, framesSinceLastLog },
    }
  }

  const rms = calculateRmsEnergy(buffer, options.encoding)
  const fps =
    state.lastLogAtMs === null || elapsedMs === null || elapsedMs <= 0
      ? framesSinceLastLog
      : framesSinceLastLog / (elapsedMs / 1000)
  const line = `[PCMDBG] sr=${buffer.sampleRate}Hz ch=${buffer.channels} bytes=${buffer.data.byteLength} samples=${countSamples(buffer, options.encoding)} rms=${rms.toFixed(3)} frames=${framesSinceLastLog} fps=${fps.toFixed(1)} ts=${buffer.timestamp.toFixed(3)}`

  return {
    line,
    state: {
      framesSinceLastLog: 0,
      lastLogAtMs: options.nowMs,
    },
  }
}
