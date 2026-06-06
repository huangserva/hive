import { describe, expect, test } from 'vitest'

import {
  applyNeuralVoiceVadProbabilitySample,
  assessNeuralVoiceSegmentQuality,
  createInitialNeuralVoiceSegmentQualityState,
  createInitialNeuralVoiceVadState,
  DEFAULT_BARGE_IN_VOLUME_OVERRIDE_CONFIG,
  DEFAULT_NEURAL_VOICE_VAD_CONFIG,
  type NeuralVoiceVadEvent,
  type NeuralVoiceVadState,
  recordNeuralVoiceSegmentQualitySample,
  shouldTriggerBargeInVolumeOverride,
  shouldUseVolumeVadFallback,
} from '../src/lib/neural-voice-vad'

const applyProbabilities = (
  probabilities: number[],
  initialState: NeuralVoiceVadState = createInitialNeuralVoiceVadState()
) => {
  let state = initialState
  const events: NeuralVoiceVadEvent[] = []
  probabilities.forEach((probability, index) => {
    const result = applyNeuralVoiceVadProbabilitySample(state, {
      probability,
      timestampMs: index * DEFAULT_NEURAL_VOICE_VAD_CONFIG.frameDurationMs,
    })
    state = result.state
    if (result.event) events.push(result.event)
  })
  return { events, state }
}

describe('neural voice VAD decision logic', () => {
  test('ends continuous speech after real voice followed by sustained low voice probability', () => {
    const lowFrameCount =
      Math.ceil(
        DEFAULT_NEURAL_VOICE_VAD_CONFIG.speechEndDurationMs /
          DEFAULT_NEURAL_VOICE_VAD_CONFIG.frameDurationMs
      ) + 1
    const { events, state } = applyProbabilities([
      0.02,
      0.84,
      0.91,
      ...Array.from({ length: lowFrameCount }, () => 0.08),
    ])

    expect(events).toEqual(['speechStart', 'speechEnd'])
    expect(state.hadRealSpeech).toBe(true)
    expect(state.phase).toBe('listening')
    expect(state.lowVoiceProbabilityMs).toBe(0)
  })

  test('ends continuous speech after sustained uncertain non-speech probability', () => {
    const uncertainFrameCount =
      Math.ceil(
        DEFAULT_NEURAL_VOICE_VAD_CONFIG.speechEndDurationMs /
          DEFAULT_NEURAL_VOICE_VAD_CONFIG.frameDurationMs
      ) + 1
    const { events, state } = applyProbabilities([
      0.92,
      ...Array.from({ length: uncertainFrameCount }, () => 0.45),
    ])

    expect(events).toEqual(['speechStart', 'speechEnd'])
    expect(state.phase).toBe('listening')
  })

  test('keeps natural 1.2s speaking pauses open and ends after 1.6s of low voice probability', () => {
    let state = createInitialNeuralVoiceVadState()
    const speechStart = applyNeuralVoiceVadProbabilitySample(state, {
      durationMs: 32,
      probability: 0.92,
      timestampMs: 0,
    })
    state = speechStart.state

    const naturalPause = applyNeuralVoiceVadProbabilitySample(state, {
      durationMs: 1_200,
      probability: 0.08,
      timestampMs: 1_200,
    })
    state = naturalPause.state

    const fullStop = applyNeuralVoiceVadProbabilitySample(state, {
      durationMs: 400,
      probability: 0.08,
      timestampMs: 1_600,
    })

    expect(speechStart.event).toBe('speechStart')
    expect(naturalPause.event).toBeNull()
    expect(naturalPause.state.phase).toBe('capturing')
    expect(fullStop.event).toBe('speechEnd')
    expect(fullStop.state.phase).toBe('listening')
  })

  test('does not end a segment before neural voice evidence exists', () => {
    const { events, state } = applyProbabilities(Array.from({ length: 40 }, () => 0.03))

    expect(events).toEqual([])
    expect(state.hadRealSpeech).toBe(false)
  })

  test('requires sustained high neural probability before barge-in', () => {
    let state = createInitialNeuralVoiceVadState()
    const first = applyNeuralVoiceVadProbabilitySample(
      state,
      { probability: 0.92, timestampMs: 0 },
      DEFAULT_NEURAL_VOICE_VAD_CONFIG,
      'barge_in'
    )
    state = first.state
    const second = applyNeuralVoiceVadProbabilitySample(
      state,
      {
        probability: 0.94,
        timestampMs: DEFAULT_NEURAL_VOICE_VAD_CONFIG.frameDurationMs,
      },
      DEFAULT_NEURAL_VOICE_VAD_CONFIG,
      'barge_in'
    )
    state = second.state
    const third = applyNeuralVoiceVadProbabilitySample(
      state,
      {
        probability: 0.95,
        timestampMs: DEFAULT_NEURAL_VOICE_VAD_CONFIG.frameDurationMs * 2,
      },
      DEFAULT_NEURAL_VOICE_VAD_CONFIG,
      'barge_in'
    )

    expect(first.event).toBeNull()
    expect(second.event).toBeNull()
    expect(third.event).toBe('speechStart')
  })

  test('does not trigger barge-in on low neural probability noise', () => {
    let state = createInitialNeuralVoiceVadState()
    const events: NeuralVoiceVadEvent[] = []
    for (let index = 0; index < 12; index += 1) {
      const result = applyNeuralVoiceVadProbabilitySample(
        state,
        {
          probability: 0.22,
          timestampMs: index * DEFAULT_NEURAL_VOICE_VAD_CONFIG.frameDurationMs,
        },
        DEFAULT_NEURAL_VOICE_VAD_CONFIG,
        'barge_in'
      )
      state = result.state
      if (result.event) events.push(result.event)
    }

    expect(events).toEqual([])
    expect(state.highVoiceProbabilityMs).toBe(0)
  })

  test('falls back to volume VAD when neural scoring is unavailable or stale', () => {
    expect(
      shouldUseVolumeVadFallback({
        latestNeuralSampleAtMs: null,
        neuralEnabled: true,
        nowMs: 1_000,
      })
    ).toBe(true)
    expect(
      shouldUseVolumeVadFallback({
        latestNeuralSampleAtMs: 0,
        neuralEnabled: true,
        nowMs: DEFAULT_NEURAL_VOICE_VAD_CONFIG.neuralFreshnessMs + 1,
      })
    ).toBe(true)
    expect(
      shouldUseVolumeVadFallback({
        latestNeuralSampleAtMs: 900,
        neuralEnabled: true,
        nowMs: 1_000,
      })
    ).toBe(false)
    expect(
      shouldUseVolumeVadFallback({
        latestNeuralSampleAtMs: 1_000,
        neuralEnabled: false,
        nowMs: 1_000,
      })
    ).toBe(true)
  })

  test('keeps neural-recent volume override quiet for echo-level playback audio', () => {
    expect(
      shouldTriggerBargeInVolumeOverride({
        baselineDb: -50,
        meteringDb: -50,
      }).shouldOverride
    ).toBe(false)
    expect(
      shouldTriggerBargeInVolumeOverride({
        baselineDb: -50,
        meteringDb: -35,
      }).shouldOverride
    ).toBe(false)
  })

  test('allows loud user interjection to override neural-recent suppression', () => {
    const decision = shouldTriggerBargeInVolumeOverride({
      baselineDb: -50,
      meteringDb: -2,
    })

    expect(decision.shouldOverride).toBe(true)
    expect(decision.absolute).toBe(true)
  })

  test('allows relative volume override thresholds to be tuned', () => {
    const decision = shouldTriggerBargeInVolumeOverride({
      baselineDb: -34,
      config: {
        ...DEFAULT_BARGE_IN_VOLUME_OVERRIDE_CONFIG,
        relativeThresholdDb: 10,
      },
      meteringDb: -22,
    })

    expect(decision.shouldOverride).toBe(true)
    expect(decision.relative).toBe(true)
  })

  test('drops low quality neural voice segments before STT upload', () => {
    let quality = createInitialNeuralVoiceSegmentQualityState()
    for (let index = 0; index < 44; index += 1) {
      quality = recordNeuralVoiceSegmentQualitySample(quality, {
        durationMs: 32,
        probability: index === 0 || index >= 41 ? 0.76 : 0.18,
        rms: 0.03,
      })
    }

    const decision = assessNeuralVoiceSegmentQuality(quality)

    expect(decision.shouldUpload).toBe(false)
    expect(decision.reason).toBe('low_high_probability_ratio')
    expect(decision.metrics.highProbabilityDurationMs).toBe(128)
  })

  test('keeps conservative normal voice segments uploadable', () => {
    let quality = createInitialNeuralVoiceSegmentQualityState()
    for (let index = 0; index < 38; index += 1) {
      quality = recordNeuralVoiceSegmentQualitySample(quality, {
        durationMs: 32,
        probability: index < 25 ? 0.86 : 0.52,
        rms: 0.08,
      })
    }

    const decision = assessNeuralVoiceSegmentQuality(quality)

    expect(decision.shouldUpload).toBe(true)
    expect(decision.reason).toBe('ok')
    expect(decision.metrics.averageProbability).toBeGreaterThan(0.7)
    expect(decision.metrics.highProbabilityRatio).toBeGreaterThan(0.5)
  })

  test('keeps uncertain but plausible speech segments uploadable to avoid false drops', () => {
    let quality = createInitialNeuralVoiceSegmentQualityState()
    for (let index = 0; index < 52; index += 1) {
      quality = recordNeuralVoiceSegmentQualitySample(quality, {
        durationMs: 32,
        probability: index === 0 || index === 51 ? 0.92 : 0.45,
        rms: 0.06,
      })
    }

    const decision = assessNeuralVoiceSegmentQuality(quality)

    expect(decision.shouldUpload).toBe(true)
    expect(decision.reason).toBe('ok')
    expect(decision.metrics.highProbabilityRatio).toBeLessThan(0.1)
  })

  test('keeps short real speech uploadable despite the low-probability speech-end tail', () => {
    let quality = createInitialNeuralVoiceSegmentQualityState()
    for (let index = 0; index < 6; index += 1) {
      quality = recordNeuralVoiceSegmentQualitySample(quality, {
        durationMs: 32,
        probability: 0.88,
        rms: 0.09,
      })
    }
    for (let index = 0; index < 51; index += 1) {
      quality = recordNeuralVoiceSegmentQualitySample(quality, {
        durationMs: 32,
        probability: 0.04,
        rms: 0.01,
      })
    }

    const decision = assessNeuralVoiceSegmentQuality(quality)

    expect(decision.shouldUpload).toBe(true)
    expect(decision.reason).toBe('ok')
    expect(decision.metrics.activeSpeechDurationMs).toBe(192)
    expect(decision.metrics.silenceTailDurationMs).toBe(1_632)
  })

  test('does not drop when only average probability is low but strong voice evidence exists', () => {
    let quality = createInitialNeuralVoiceSegmentQualityState()
    for (let index = 0; index < 50; index += 1) {
      quality = recordNeuralVoiceSegmentQualitySample(quality, {
        durationMs: 32,
        probability: index < 5 || index >= 45 ? 0.82 : 0.22,
        rms: index < 5 || index >= 45 ? 0.08 : 0.04,
      })
    }

    const decision = assessNeuralVoiceSegmentQuality(quality)

    expect(decision.shouldUpload).toBe(true)
    expect(decision.reason).toBe('ok')
    expect(decision.metrics.averageProbability).toBeLessThan(0.35)
  })
})
