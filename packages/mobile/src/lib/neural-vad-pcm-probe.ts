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

export const createInitialPcmProbeLogState = (): PcmProbeLogState => ({
  framesSinceLastLog: 0,
  lastLogAtMs: null,
})

export const resolveNeuralVadPcmProbeEnabled = (env: Record<string, string | undefined>) => {
  const value = env.EXPO_PUBLIC_NEURAL_VAD_PCM_PROBE
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
