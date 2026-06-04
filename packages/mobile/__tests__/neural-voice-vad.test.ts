import { describe, expect, test } from 'vitest'

import {
  applyNeuralVoiceVadProbabilitySample,
  createInitialNeuralVoiceVadState,
  DEFAULT_NEURAL_VOICE_VAD_CONFIG,
  type NeuralVoiceVadEvent,
  type NeuralVoiceVadState,
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
})
