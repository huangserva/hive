export const DEFAULT_NEURAL_VOICE_VAD_CONFIG = {
  bargeInProbability: 0.7,
  bargeInDurationMs: 96,
  frameDurationMs: 32,
  neuralFreshnessMs: 1_000,
  speechEndDurationMs: 1_600,
  speechEndProbability: 0.4,
  speechStartProbability: 0.7,
} as const

export type NeuralVoiceVadConfig = {
  [Key in keyof typeof DEFAULT_NEURAL_VOICE_VAD_CONFIG]: number
}

export type NeuralVoiceVadMode = 'continuous' | 'barge_in'

export type NeuralVoiceVadEvent = 'speechStart' | 'speechEnd'

export type NeuralVoiceVadState = {
  hadRealSpeech: boolean
  highVoiceProbabilityMs: number
  lastSampleAtMs: number | null
  lowVoiceProbabilityMs: number
  phase: 'listening' | 'capturing'
}

export const createInitialNeuralVoiceVadState = (): NeuralVoiceVadState => ({
  hadRealSpeech: false,
  highVoiceProbabilityMs: 0,
  lastSampleAtMs: null,
  lowVoiceProbabilityMs: 0,
  phase: 'listening',
})

const resolveSampleDurationMs = (
  state: NeuralVoiceVadState,
  sample: { durationMs?: number; timestampMs: number },
  config: NeuralVoiceVadConfig
) => {
  if (typeof sample.durationMs === 'number') return Math.max(0, sample.durationMs)
  if (state.lastSampleAtMs === null) return config.frameDurationMs
  return Math.max(0, sample.timestampMs - state.lastSampleAtMs)
}

export const applyNeuralVoiceVadProbabilitySample = (
  state: NeuralVoiceVadState,
  sample: { durationMs?: number; probability: number; timestampMs: number },
  config: NeuralVoiceVadConfig = DEFAULT_NEURAL_VOICE_VAD_CONFIG,
  mode: NeuralVoiceVadMode = 'continuous'
): { event: NeuralVoiceVadEvent | null; state: NeuralVoiceVadState } => {
  if (!Number.isFinite(sample.probability)) {
    return { event: null, state }
  }

  const probability = Math.max(0, Math.min(1, sample.probability))
  const durationMs = resolveSampleDurationMs(state, sample, config)

  if (mode === 'barge_in') {
    const highVoiceProbabilityMs =
      probability >= config.bargeInProbability ? state.highVoiceProbabilityMs + durationMs : 0
    return {
      event: highVoiceProbabilityMs >= config.bargeInDurationMs ? 'speechStart' : null,
      state: {
        ...state,
        hadRealSpeech: state.hadRealSpeech || highVoiceProbabilityMs >= config.bargeInDurationMs,
        highVoiceProbabilityMs,
        lastSampleAtMs: sample.timestampMs,
        lowVoiceProbabilityMs: 0,
        phase:
          state.phase === 'capturing' || highVoiceProbabilityMs >= config.bargeInDurationMs
            ? 'capturing'
            : 'listening',
      },
    }
  }

  const hadRealSpeech = state.hadRealSpeech || probability >= config.speechStartProbability
  const phase =
    state.phase === 'capturing' || probability >= config.speechStartProbability
      ? 'capturing'
      : 'listening'
  const highVoiceProbabilityMs =
    probability >= config.speechStartProbability ? state.highVoiceProbabilityMs + durationMs : 0
  const lowVoiceProbabilityMs =
    phase === 'capturing' && hadRealSpeech && probability < config.speechStartProbability
      ? state.lowVoiceProbabilityMs + durationMs
      : 0
  const speechStartEvent = !state.hadRealSpeech && hadRealSpeech ? 'speechStart' : null
  const speechEndEvent = lowVoiceProbabilityMs >= config.speechEndDurationMs ? 'speechEnd' : null

  return {
    event: speechEndEvent ?? speechStartEvent,
    state: {
      hadRealSpeech,
      highVoiceProbabilityMs,
      lastSampleAtMs: sample.timestampMs,
      lowVoiceProbabilityMs: speechEndEvent ? 0 : lowVoiceProbabilityMs,
      phase: speechEndEvent ? 'listening' : phase,
    },
  }
}

export const shouldUseVolumeVadFallback = ({
  config = DEFAULT_NEURAL_VOICE_VAD_CONFIG,
  latestNeuralSampleAtMs,
  neuralEnabled,
  nowMs,
}: {
  config?: NeuralVoiceVadConfig
  latestNeuralSampleAtMs: number | null
  neuralEnabled: boolean
  nowMs: number
}) =>
  !neuralEnabled ||
  latestNeuralSampleAtMs === null ||
  nowMs - latestNeuralSampleAtMs > config.neuralFreshnessMs

export const buildNeuralVoiceVadDebugLine = ({
  event,
  mode,
  probability,
}: {
  event: NeuralVoiceVadEvent | null
  mode: NeuralVoiceVadMode
  probability: number
}) => `[VADDBG] mode=neural-${mode} voice_prob=${probability.toFixed(3)} ev=${event ?? 'none'}`
