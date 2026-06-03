import { describe, expect, test } from 'vitest'

import {
  applyVadMeteringSample,
  createInitialVoiceVadState,
  DEFAULT_VAD_CONFIG,
  type VoiceVadEvent,
  type VoiceVadState,
} from '../src/lib/voice-vad'

describe('voice VAD metering', () => {
  const applySamples = (
    samples: Array<{ metering: number | null; timestampMs: number }>,
    initialState: VoiceVadState = createInitialVoiceVadState()
  ) => {
    let state = initialState
    const events: VoiceVadEvent[] = []
    for (const sample of samples) {
      const result = applyVadMeteringSample(state, sample)
      state = result.state
      if (result.event) events.push(result.event)
    }
    return { events, state }
  }

  test('recovers from startup garbage metering and ends speech for the real logcat sequence', () => {
    const { events, state } = applySamples([
      { metering: -160, timestampMs: 0 },
      { metering: -159, timestampMs: 200 },
      { metering: -20, timestampMs: 400 },
      { metering: -25, timestampMs: 600 },
      { metering: -33, timestampMs: 800 },
      { metering: -19, timestampMs: 1000 },
      { metering: -35, timestampMs: 1200 },
      { metering: -41, timestampMs: 1400 },
      { metering: -43, timestampMs: 1600 },
      { metering: -42, timestampMs: 1800 },
      { metering: -44, timestampMs: 2000 },
      { metering: -41, timestampMs: 2200 },
      { metering: -42, timestampMs: 2400 },
      { metering: -44, timestampMs: 2600 },
    ])

    expect(events).toEqual(['speechStart', 'speechEnd'])
    expect(state.phase).toBe('listening')
    expect(state.noiseFloorDb).toBeGreaterThanOrEqual(-45)
    expect(state.noiseFloorDb).toBeLessThanOrEqual(-40)
    expect(state.recentSpeechDb).toBeGreaterThan(-30)
    expect(state.hadRealSpeech).toBe(true)
  })

  test('adapts to a -55dB noise floor and still detects speech and silence', () => {
    const { events, state } = applySamples([
      { metering: -55, timestampMs: 0 },
      { metering: -56, timestampMs: 200 },
      { metering: -55, timestampMs: 400 },
      { metering: -39, timestampMs: 600 },
      { metering: -37, timestampMs: 800 },
      { metering: -55, timestampMs: 1000 },
      { metering: -55, timestampMs: 1600 },
      { metering: -55, timestampMs: 2200 },
    ])

    expect(events).toEqual(['speechStart', 'speechEnd'])
    expect(state.phase).toBe('listening')
    expect(state.noiseFloorDb).toBeLessThanOrEqual(-54)
    expect(state.hadRealSpeech).toBe(true)
  })

  test('does not drop the first phrase when speech starts before the noise floor is established', () => {
    const { events, state } = applySamples([
      { metering: -20, timestampMs: 0 },
      { metering: -22, timestampMs: 200 },
      { metering: -25, timestampMs: 400 },
      { metering: -44, timestampMs: 800 },
      { metering: -44, timestampMs: 2000 },
    ])

    expect(events).toEqual(['speechStart', 'speechEnd'])
    expect(state.phase).toBe('listening')
    expect(state.hadRealSpeech).toBe(true)
  })

  test('marks noise-triggered segments as not real speech', () => {
    const { events, state } = applySamples([
      { metering: -44, timestampMs: 0 },
      { metering: -43, timestampMs: 200 },
      { metering: -29, timestampMs: 400 },
      { metering: -44, timestampMs: 800 },
      { metering: -43, timestampMs: 1400 },
      { metering: -44, timestampMs: 2000 },
    ])

    expect(events).toEqual(['speechStart', 'speechEnd'])
    expect(state.hadRealSpeech).toBe(false)
    expect(state.realSpeechMs).toBe(0)
  })

  test('keeps short but loud speech as real speech', () => {
    const { events, state } = applySamples([
      { metering: -45, timestampMs: 0 },
      { metering: -44, timestampMs: 200 },
      { metering: -18, timestampMs: 400 },
      { metering: -18, timestampMs: 800 },
      { metering: -45, timestampMs: 1200 },
      { metering: -44, timestampMs: 1800 },
      { metering: -45, timestampMs: 2400 },
    ])

    expect(events).toEqual(['speechStart', 'speechEnd'])
    expect(state.hadRealSpeech).toBe(true)
    expect(state.realSpeechMs).toBeLessThan(DEFAULT_VAD_CONFIG.minRealSpeechMs)
  })

  test('does not end a phrase for a short pause below the silence threshold', () => {
    const { events, state } = applySamples([
      { metering: -50, timestampMs: 0 },
      { metering: -50, timestampMs: 200 },
      { metering: -36, timestampMs: 400 },
      { metering: -50, timestampMs: DEFAULT_VAD_CONFIG.silenceDurationMs - 200 },
    ])

    expect(events).toEqual(['speechStart'])
    expect(state.phase).toBe('capturing')
  })

  test('ends a phrase only after sustained silence', () => {
    const { events, state } = applySamples([
      { metering: -50, timestampMs: 0 },
      { metering: -50, timestampMs: 200 },
      { metering: -36, timestampMs: 400 },
      { metering: -50, timestampMs: 800 },
      { metering: -50, timestampMs: 800 + DEFAULT_VAD_CONFIG.silenceDurationMs },
    ])

    expect(events).toEqual(['speechStart', 'speechEnd'])
    expect(state.phase).toBe('listening')
  })

  test('resets the silence timer when speech resumes before timeout', () => {
    const { events, state } = applySamples([
      { metering: -50, timestampMs: 0 },
      { metering: -50, timestampMs: 200 },
      { metering: -36, timestampMs: 400 },
      { metering: -50, timestampMs: 800 },
      { metering: -36, timestampMs: 1100 },
      { metering: -50, timestampMs: 800 + DEFAULT_VAD_CONFIG.silenceDurationMs },
    ])

    expect(events).toEqual(['speechStart'])
    expect(state.phase).toBe('capturing')
  })

  test('ignores null and startup garbage metering without polluting floor or recent speech', () => {
    const first = applyVadMeteringSample(createInitialVoiceVadState(), {
      metering: -50,
      timestampMs: 0,
    }).state

    const afterNull = applyVadMeteringSample(first, {
      metering: null,
      timestampMs: 200,
    }).state
    const result = applyVadMeteringSample(afterNull, {
      metering: -160,
      timestampMs: 400,
    })

    expect(result.event).toBeNull()
    expect(result.state).toEqual(first)
  })

  test('does not end speech for normal short pauses between words', () => {
    const { events, state } = applySamples([
      { metering: -45, timestampMs: 0 },
      { metering: -44, timestampMs: 200 },
      { metering: -20, timestampMs: 400 },
      { metering: -41, timestampMs: 700 },
      { metering: -22, timestampMs: 900 },
      { metering: -40, timestampMs: 1100 },
      { metering: -25, timestampMs: 1300 },
    ])

    expect(events).toEqual(['speechStart'])
    expect(state.phase).toBe('capturing')
  })

  test('does not end speech while sustained loud speech raises the rolling floor', () => {
    const { events, state } = applySamples([
      { metering: -45, timestampMs: 0 },
      { metering: -44, timestampMs: 200 },
      { metering: -12, timestampMs: 400 },
      { metering: -13, timestampMs: 600 },
      { metering: -14, timestampMs: 800 },
      { metering: -12, timestampMs: 1000 },
      { metering: -13, timestampMs: 1200 },
      { metering: -14, timestampMs: 1400 },
      { metering: -12, timestampMs: 1600 },
      { metering: -13, timestampMs: 1800 },
      { metering: -14, timestampMs: 2000 },
      { metering: -12, timestampMs: 2200 },
      { metering: -13, timestampMs: 2400 },
      { metering: -14, timestampMs: 2600 },
      { metering: -12, timestampMs: 2800 },
      { metering: -13, timestampMs: 3000 },
      { metering: -12.4, timestampMs: 3200 },
    ])

    expect(events).toEqual(['speechStart'])
    expect(state.phase).toBe('capturing')
    expect(state.noiseFloorDb).toBeGreaterThan(-20)
  })

  test('ends sustained loud speech only after a real drop to silence', () => {
    const { events, state } = applySamples([
      { metering: -45, timestampMs: 0 },
      { metering: -44, timestampMs: 200 },
      { metering: -12, timestampMs: 400 },
      { metering: -13, timestampMs: 600 },
      { metering: -14, timestampMs: 800 },
      { metering: -12, timestampMs: 1000 },
      { metering: -13, timestampMs: 1200 },
      { metering: -14, timestampMs: 1400 },
      { metering: -12, timestampMs: 1600 },
      { metering: -45, timestampMs: 1800 },
      { metering: -45, timestampMs: 2400 },
      { metering: -45, timestampMs: 3000 },
    ])

    expect(events).toEqual(['speechStart', 'speechEnd'])
    expect(state.phase).toBe('listening')
  })
})
