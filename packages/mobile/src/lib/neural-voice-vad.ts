export const DEFAULT_NEURAL_VOICE_VAD_CONFIG = {
  bargeInProbability: 0.7,
  bargeInDurationMs: 96,
  frameDurationMs: 32,
  neuralFreshnessMs: 1_000,
  speechEndDurationMs: 1_600,
  speechEndProbability: 0.4,
  speechStartProbability: 0.7,
} as const

export const DEFAULT_NEURAL_VOICE_SEGMENT_QUALITY_CONFIG = {
  highProbability: 0.7,
  minAverageProbability: 0.35,
  minHighProbabilityDurationMs: 160,
  minHighProbabilityRatio: 0.2,
} as const

export const DEFAULT_BARGE_IN_VOLUME_OVERRIDE_CONFIG = {
  absoluteThresholdDb: -12,
  minRelativeBaselineDb: -45,
  relativeThresholdDb: 22,
} as const

export type NeuralVoiceVadConfig = {
  [Key in keyof typeof DEFAULT_NEURAL_VOICE_VAD_CONFIG]: number
}

export type BargeInVolumeOverrideConfig = {
  [Key in keyof typeof DEFAULT_BARGE_IN_VOLUME_OVERRIDE_CONFIG]: number
}

export type BargeInVolumeOverrideDecision = {
  absolute: boolean
  baselineDb: number | null
  deltaDb: number | null
  relative: boolean
  shouldOverride: boolean
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

export type NeuralVoiceSegmentQualityState = {
  highProbabilityDurationMs: number
  sampleCount: number
  trailingLowProbabilityDurationMs: number
  trailingLowProbabilitySampleCount: number
  trailingLowProbabilityTotalProbability: number
  trailingLowProbabilityTotalRms: number
  totalDurationMs: number
  totalProbability: number
  totalRms: number
}

export type NeuralVoiceSegmentQualityMetrics = {
  activeSpeechDurationMs: number
  activeSpeechSampleCount: number
  averageProbability: number
  averageRms: number
  highProbabilityDurationMs: number
  highProbabilityRatio: number
  silenceTailDurationMs: number
  silenceTailSampleCount: number
  sampleCount: number
  totalDurationMs: number
}

export type NeuralVoiceSegmentQualityDropReason = 'low_high_probability_ratio'

export type NeuralVoiceSegmentQualityDecision = {
  metrics: NeuralVoiceSegmentQualityMetrics
  reason: NeuralVoiceSegmentQualityDropReason | 'insufficient_neural_samples' | 'ok'
  shouldUpload: boolean
}

export const createInitialNeuralVoiceVadState = (): NeuralVoiceVadState => ({
  hadRealSpeech: false,
  highVoiceProbabilityMs: 0,
  lastSampleAtMs: null,
  lowVoiceProbabilityMs: 0,
  phase: 'listening',
})

export const createInitialNeuralVoiceSegmentQualityState = (): NeuralVoiceSegmentQualityState => ({
  highProbabilityDurationMs: 0,
  sampleCount: 0,
  trailingLowProbabilityDurationMs: 0,
  trailingLowProbabilitySampleCount: 0,
  trailingLowProbabilityTotalProbability: 0,
  trailingLowProbabilityTotalRms: 0,
  totalDurationMs: 0,
  totalProbability: 0,
  totalRms: 0,
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

export const shouldTriggerBargeInVolumeOverride = ({
  baselineDb,
  config = DEFAULT_BARGE_IN_VOLUME_OVERRIDE_CONFIG,
  meteringDb,
}: {
  baselineDb: number | null
  config?: BargeInVolumeOverrideConfig
  meteringDb: number | null
}): BargeInVolumeOverrideDecision => {
  if (meteringDb === null || !Number.isFinite(meteringDb)) {
    return {
      absolute: false,
      baselineDb,
      deltaDb: null,
      relative: false,
      shouldOverride: false,
    }
  }

  const absolute = meteringDb >= config.absoluteThresholdDb
  const canUseRelative =
    baselineDb !== null && Number.isFinite(baselineDb) && baselineDb >= config.minRelativeBaselineDb
  const deltaDb = canUseRelative ? meteringDb - baselineDb : null
  const relative = deltaDb !== null && deltaDb >= config.relativeThresholdDb

  return {
    absolute,
    baselineDb,
    deltaDb,
    relative,
    shouldOverride: absolute || relative,
  }
}

export const recordNeuralVoiceSegmentQualitySample = (
  state: NeuralVoiceSegmentQualityState,
  sample: { durationMs: number; probability: number; rms: number },
  config = DEFAULT_NEURAL_VOICE_SEGMENT_QUALITY_CONFIG
): NeuralVoiceSegmentQualityState => {
  if (!Number.isFinite(sample.probability) || !Number.isFinite(sample.durationMs)) return state
  const durationMs = Math.max(0, sample.durationMs)
  const probability = Math.max(0, Math.min(1, sample.probability))
  const rms = Number.isFinite(sample.rms) ? Math.max(0, sample.rms) : 0
  const isHighProbability = probability >= config.highProbability
  return {
    highProbabilityDurationMs:
      state.highProbabilityDurationMs + (isHighProbability ? durationMs : 0),
    sampleCount: state.sampleCount + 1,
    trailingLowProbabilityDurationMs: isHighProbability
      ? 0
      : state.trailingLowProbabilityDurationMs + durationMs,
    trailingLowProbabilitySampleCount: isHighProbability
      ? 0
      : state.trailingLowProbabilitySampleCount + 1,
    trailingLowProbabilityTotalProbability: isHighProbability
      ? 0
      : state.trailingLowProbabilityTotalProbability + probability,
    trailingLowProbabilityTotalRms: isHighProbability
      ? 0
      : state.trailingLowProbabilityTotalRms + rms,
    totalDurationMs: state.totalDurationMs + durationMs,
    totalProbability: state.totalProbability + probability,
    totalRms: state.totalRms + rms,
  }
}

export const getNeuralVoiceSegmentQualityMetrics = (
  state: NeuralVoiceSegmentQualityState
): NeuralVoiceSegmentQualityMetrics => {
  const activeSpeechSampleCount = Math.max(
    0,
    state.sampleCount - state.trailingLowProbabilitySampleCount
  )
  const activeSpeechDurationMs = Math.max(
    0,
    state.totalDurationMs - state.trailingLowProbabilityDurationMs
  )
  const activeTotalProbability = Math.max(
    0,
    state.totalProbability - state.trailingLowProbabilityTotalProbability
  )
  const activeTotalRms = Math.max(0, state.totalRms - state.trailingLowProbabilityTotalRms)
  const averageProbability =
    activeSpeechSampleCount > 0 ? activeTotalProbability / activeSpeechSampleCount : 0
  const averageRms = activeSpeechSampleCount > 0 ? activeTotalRms / activeSpeechSampleCount : 0
  const highProbabilityRatio =
    activeSpeechDurationMs > 0 ? state.highProbabilityDurationMs / activeSpeechDurationMs : 0
  return {
    activeSpeechDurationMs,
    activeSpeechSampleCount,
    averageProbability,
    averageRms,
    highProbabilityDurationMs: state.highProbabilityDurationMs,
    highProbabilityRatio,
    silenceTailDurationMs: state.trailingLowProbabilityDurationMs,
    silenceTailSampleCount: state.trailingLowProbabilitySampleCount,
    sampleCount: state.sampleCount,
    totalDurationMs: state.totalDurationMs,
  }
}

export const assessNeuralVoiceSegmentQuality = (
  state: NeuralVoiceSegmentQualityState,
  config = DEFAULT_NEURAL_VOICE_SEGMENT_QUALITY_CONFIG
): NeuralVoiceSegmentQualityDecision => {
  const metrics = getNeuralVoiceSegmentQualityMetrics(state)
  if (metrics.sampleCount === 0 || metrics.totalDurationMs === 0) {
    return { metrics, reason: 'insufficient_neural_samples', shouldUpload: true }
  }
  if (
    metrics.averageProbability < config.minAverageProbability &&
    metrics.highProbabilityRatio < config.minHighProbabilityRatio &&
    metrics.highProbabilityDurationMs < config.minHighProbabilityDurationMs
  ) {
    return { metrics, reason: 'low_high_probability_ratio', shouldUpload: false }
  }
  return { metrics, reason: 'ok', shouldUpload: true }
}

export const buildNeuralVoiceVadDebugLine = ({
  event,
  mode,
  probability,
}: {
  event: NeuralVoiceVadEvent | null
  mode: NeuralVoiceVadMode
  probability: number
}) => `[VADDBG] mode=neural-${mode} voice_prob=${probability.toFixed(3)} ev=${event ?? 'none'}`
