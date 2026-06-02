import { describe, expect, test } from 'vitest'

import {
  applyVadMeteringSample,
  createInitialVoiceVadState,
  DEFAULT_VAD_CONFIG,
} from '../src/lib/voice-vad'

describe('voice VAD metering', () => {
  test('detects speech start when metering crosses the speech threshold', () => {
    const result = applyVadMeteringSample(createInitialVoiceVadState(), {
      metering: DEFAULT_VAD_CONFIG.speechThresholdDb + 1,
      timestampMs: 100,
    })

    expect(result.event).toBe('speechStart')
    expect(result.state.phase).toBe('capturing')
  })

  test('does not end a phrase for a short pause below the silence threshold', () => {
    const capturing = applyVadMeteringSample(createInitialVoiceVadState(), {
      metering: DEFAULT_VAD_CONFIG.speechThresholdDb + 1,
      timestampMs: 0,
    }).state

    const result = applyVadMeteringSample(capturing, {
      metering: DEFAULT_VAD_CONFIG.silenceThresholdDb - 1,
      timestampMs: DEFAULT_VAD_CONFIG.silenceDurationMs - 200,
    })

    expect(result.event).toBeNull()
    expect(result.state.phase).toBe('capturing')
  })

  test('ends a phrase only after sustained silence', () => {
    let state = applyVadMeteringSample(createInitialVoiceVadState(), {
      metering: DEFAULT_VAD_CONFIG.speechThresholdDb + 1,
      timestampMs: 0,
    }).state
    state = applyVadMeteringSample(state, {
      metering: DEFAULT_VAD_CONFIG.silenceThresholdDb - 1,
      timestampMs: 400,
    }).state

    const result = applyVadMeteringSample(state, {
      metering: DEFAULT_VAD_CONFIG.silenceThresholdDb - 1,
      timestampMs: 400 + DEFAULT_VAD_CONFIG.silenceDurationMs,
    })

    expect(result.event).toBe('speechEnd')
    expect(result.state.phase).toBe('listening')
  })

  test('resets the silence timer when speech resumes before timeout', () => {
    let state = applyVadMeteringSample(createInitialVoiceVadState(), {
      metering: DEFAULT_VAD_CONFIG.speechThresholdDb + 1,
      timestampMs: 0,
    }).state
    state = applyVadMeteringSample(state, {
      metering: DEFAULT_VAD_CONFIG.silenceThresholdDb - 1,
      timestampMs: 400,
    }).state
    state = applyVadMeteringSample(state, {
      metering: DEFAULT_VAD_CONFIG.speechThresholdDb + 1,
      timestampMs: 900,
    }).state

    const result = applyVadMeteringSample(state, {
      metering: DEFAULT_VAD_CONFIG.silenceThresholdDb - 1,
      timestampMs: 400 + DEFAULT_VAD_CONFIG.silenceDurationMs,
    })

    expect(result.event).toBeNull()
    expect(result.state.phase).toBe('capturing')
  })
})
