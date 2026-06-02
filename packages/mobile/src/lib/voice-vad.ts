export const DEFAULT_VAD_CONFIG = {
  silenceDurationMs: 1200,
  silenceThresholdDb: -52,
  speechThresholdDb: -42,
} as const

export type VoiceVadConfig = typeof DEFAULT_VAD_CONFIG

export type VoiceVadState = {
  phase: 'listening' | 'capturing'
  silenceStartedAtMs: number | null
}

export type VoiceVadEvent = 'speechStart' | 'speechEnd'

export const createInitialVoiceVadState = (): VoiceVadState => ({
  phase: 'listening',
  silenceStartedAtMs: null,
})

export const applyVadMeteringSample = (
  state: VoiceVadState,
  sample: { metering: number | null | undefined; timestampMs: number },
  config: VoiceVadConfig = DEFAULT_VAD_CONFIG
): { event: VoiceVadEvent | null; state: VoiceVadState } => {
  if (typeof sample.metering !== 'number' || Number.isNaN(sample.metering)) {
    return { event: null, state }
  }

  if (state.phase === 'listening') {
    if (sample.metering >= config.speechThresholdDb) {
      return {
        event: 'speechStart',
        state: { phase: 'capturing', silenceStartedAtMs: null },
      }
    }
    return { event: null, state }
  }

  if (sample.metering > config.silenceThresholdDb) {
    return {
      event: null,
      state: { phase: 'capturing', silenceStartedAtMs: null },
    }
  }

  const silenceStartedAtMs = state.silenceStartedAtMs ?? sample.timestampMs
  if (sample.timestampMs - silenceStartedAtMs >= config.silenceDurationMs) {
    return { event: 'speechEnd', state: createInitialVoiceVadState() }
  }

  return {
    event: null,
    state: { phase: 'capturing', silenceStartedAtMs },
  }
}
