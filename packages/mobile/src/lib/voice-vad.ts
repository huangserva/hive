export const DEFAULT_VAD_CONFIG = {
  confirmedSpeechMarginDb: 18,
  garbageFloorDb: -70,
  minRealSpeechMs: 500,
  recentSpeechDecayDbPerSample: 0.25,
  silenceMarginDb: 6,
  silenceDurationMs: 1200,
  shortSpeechPeakMarginDb: 24,
  silenceThresholdDb: -45,
  speechDropDb: 12,
  speechMarginDb: 14,
  speechThresholdDb: -42,
  startupSpeechThresholdDb: -38,
  windowSampleCount: 12,
} as const

export type VoiceVadConfig = {
  [Key in keyof typeof DEFAULT_VAD_CONFIG]: number
}

export type VoiceVadState = {
  confirmedSpeechPeakDb: number | null
  floorWindowDb: number[]
  hadRealSpeech: boolean
  lastValidSampleAtMs: number | null
  noiseFloorDb: number | null
  phase: 'listening' | 'capturing'
  realSpeechMs: number
  recentSpeechDb: number | null
  silenceStartedAtMs: number | null
}

export type VoiceVadEvent = 'speechStart' | 'speechEnd'

export const createInitialVoiceVadState = (): VoiceVadState => ({
  confirmedSpeechPeakDb: null,
  floorWindowDb: [],
  hadRealSpeech: false,
  lastValidSampleAtMs: null,
  noiseFloorDb: null,
  phase: 'listening',
  realSpeechMs: 0,
  recentSpeechDb: null,
  silenceStartedAtMs: null,
})

const isValidVadMetering = (metering: number, config: VoiceVadConfig) =>
  metering > config.garbageFloorDb

const updateFloorWindow = (
  currentWindowDb: readonly number[],
  metering: number,
  config: VoiceVadConfig
) => [...currentWindowDb, metering].slice(-config.windowSampleCount)

const updateRecentSpeech = (
  currentRecentSpeechDb: number | null,
  metering: number,
  config: VoiceVadConfig
) => {
  if (currentRecentSpeechDb === null) return metering
  const decayedPeak = currentRecentSpeechDb - config.recentSpeechDecayDbPerSample
  return Math.max(metering, decayedPeak)
}

const isNoiseFloorEstablished = (
  floorWindowDb: readonly number[],
  noiseFloorDb: number,
  config: VoiceVadConfig
) => floorWindowDb.length >= 8 || noiseFloorDb <= config.speechThresholdDb

const deriveHadRealSpeech = ({
  config,
  confirmedSpeechPeakDb,
}: {
  config: VoiceVadConfig
  confirmedSpeechPeakDb: number | null
}) => confirmedSpeechPeakDb !== null && confirmedSpeechPeakDb >= config.confirmedSpeechMarginDb

const updateSpeechEvidence = ({
  config,
  metering,
  noiseFloorDb,
  recentSpeechDb,
  state,
  timestampMs,
}: {
  config: VoiceVadConfig
  metering: number
  noiseFloorDb: number
  recentSpeechDb: number | null
  state: VoiceVadState
  timestampMs: number
}) => {
  const speechPeakDb = recentSpeechDb === null ? null : Math.max(0, recentSpeechDb - noiseFloorDb)
  const confirmedSpeechPeakDb =
    speechPeakDb === null
      ? state.confirmedSpeechPeakDb
      : Math.max(state.confirmedSpeechPeakDb ?? 0, speechPeakDb)
  const isConfirmedSpeechSample = metering >= noiseFloorDb + config.confirmedSpeechMarginDb
  const sampleDurationMs =
    state.lastValidSampleAtMs === null ? 0 : Math.max(0, timestampMs - state.lastValidSampleAtMs)
  const realSpeechMs = state.realSpeechMs + (isConfirmedSpeechSample ? sampleDurationMs : 0)
  return {
    confirmedSpeechPeakDb,
    hadRealSpeech: deriveHadRealSpeech({ config, confirmedSpeechPeakDb }),
    realSpeechMs,
  }
}

export const applyVadMeteringSample = (
  state: VoiceVadState,
  sample: { metering: number | null | undefined; timestampMs: number },
  config: VoiceVadConfig = DEFAULT_VAD_CONFIG
): { event: VoiceVadEvent | null; state: VoiceVadState } => {
  if (typeof sample.metering !== 'number' || Number.isNaN(sample.metering)) {
    return { event: null, state }
  }
  if (!isValidVadMetering(sample.metering, config)) {
    return { event: null, state }
  }

  const floorWindowDb = updateFloorWindow(state.floorWindowDb, sample.metering, config)
  const noiseFloorDb = Math.min(...floorWindowDb)
  const recentSpeechDb =
    state.phase === 'capturing'
      ? updateRecentSpeech(state.recentSpeechDb, sample.metering, config)
      : state.recentSpeechDb
  const speechThresholdDb = noiseFloorDb + config.speechMarginDb
  const silenceThresholdDb = noiseFloorDb + config.silenceMarginDb
  const floorEstablished = isNoiseFloorEstablished(floorWindowDb, noiseFloorDb, config)
  const shouldStartSpeech = floorEstablished
    ? sample.metering >= speechThresholdDb
    : sample.metering >= config.startupSpeechThresholdDb

  if (state.phase === 'listening') {
    if (shouldStartSpeech) {
      return {
        event: 'speechStart',
        state: {
          confirmedSpeechPeakDb: null,
          floorWindowDb,
          hadRealSpeech: false,
          lastValidSampleAtMs: sample.timestampMs,
          noiseFloorDb,
          phase: 'capturing',
          realSpeechMs: 0,
          recentSpeechDb: sample.metering,
          silenceStartedAtMs: null,
        },
      }
    }
    return {
      event: null,
      state: { ...state, floorWindowDb, lastValidSampleAtMs: sample.timestampMs, noiseFloorDb },
    }
  }

  const speechEvidence = updateSpeechEvidence({
    config,
    metering: sample.metering,
    noiseFloorDb,
    recentSpeechDb,
    state,
    timestampMs: sample.timestampMs,
  })

  const isRelativeSilence =
    recentSpeechDb !== null && sample.metering <= recentSpeechDb - config.speechDropDb
  const isFloorSilence = sample.metering <= silenceThresholdDb
  const floorWasDraggedIntoSpeechRange =
    recentSpeechDb !== null && noiseFloorDb > recentSpeechDb - config.speechDropDb
  const isSustainedSilence = isRelativeSilence && (isFloorSilence || floorWasDraggedIntoSpeechRange)
  if (!isSustainedSilence) {
    return {
      event: null,
      state: {
        ...speechEvidence,
        floorWindowDb,
        lastValidSampleAtMs: sample.timestampMs,
        noiseFloorDb,
        phase: 'capturing',
        recentSpeechDb,
        silenceStartedAtMs: null,
      },
    }
  }

  const silenceStartedAtMs = state.silenceStartedAtMs ?? sample.timestampMs
  if (sample.timestampMs - silenceStartedAtMs >= config.silenceDurationMs) {
    return {
      event: 'speechEnd',
      state: {
        ...speechEvidence,
        floorWindowDb,
        lastValidSampleAtMs: sample.timestampMs,
        noiseFloorDb,
        phase: 'listening',
        recentSpeechDb,
        silenceStartedAtMs: null,
      },
    }
  }

  return {
    event: null,
    state: {
      ...speechEvidence,
      floorWindowDb,
      lastValidSampleAtMs: sample.timestampMs,
      noiseFloorDb,
      phase: 'capturing',
      recentSpeechDb,
      silenceStartedAtMs,
    },
  }
}
