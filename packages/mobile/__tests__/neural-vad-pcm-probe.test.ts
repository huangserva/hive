import { describe, expect, test } from 'vitest'

import {
  buildPcmProbeLogLine,
  createInitialPcmProbeLogState,
  resolveNeuralVadPcmProbeEnabled,
} from '../src/lib/neural-vad-pcm-probe'

const int16Buffer = (samples: number[]) => {
  const buffer = new ArrayBuffer(samples.length * Int16Array.BYTES_PER_ELEMENT)
  new Int16Array(buffer).set(samples)
  return buffer
}

const float32Buffer = (samples: number[]) => {
  const buffer = new ArrayBuffer(samples.length * Float32Array.BYTES_PER_ELEMENT)
  new Float32Array(buffer).set(samples)
  return buffer
}

describe('neural VAD PCM probe', () => {
  test('defaults off unless explicitly enabled', () => {
    expect(resolveNeuralVadPcmProbeEnabled({})).toBe(false)
    expect(resolveNeuralVadPcmProbeEnabled({ EXPO_PUBLIC_NEURAL_VAD_PCM_PROBE: '0' })).toBe(false)
    expect(resolveNeuralVadPcmProbeEnabled({ EXPO_PUBLIC_NEURAL_VAD_PCM_PROBE: '1' })).toBe(true)
    expect(resolveNeuralVadPcmProbeEnabled({ EXPO_PUBLIC_NEURAL_VAD_PCM_PROBE: 'true' })).toBe(true)
  })

  test('summarizes int16 PCM frames with energy and arrival frequency', () => {
    let state = createInitialPcmProbeLogState()

    const first = buildPcmProbeLogLine(
      state,
      {
        channels: 1,
        data: int16Buffer([0, 16_384, -16_384, 0]),
        sampleRate: 16_000,
        timestamp: 0,
      },
      { encoding: 'int16', nowMs: 1_000 }
    )
    state = first.state

    expect(first.line).toContain('sr=16000Hz')
    expect(first.line).toContain('ch=1')
    expect(first.line).toContain('bytes=8')
    expect(first.line).toContain('samples=4')
    expect(first.line).toContain('rms=0.354')
    expect(first.line).toContain('fps=1.0')
  })

  test('summarizes float32 PCM frames and throttles intermediate logs', () => {
    let state = createInitialPcmProbeLogState()
    const first = buildPcmProbeLogLine(
      state,
      {
        channels: 1,
        data: float32Buffer([0, 0.5, -0.5, 0]),
        sampleRate: 16_000,
        timestamp: 0,
      },
      { encoding: 'float32', nowMs: 1_000 }
    )
    state = first.state

    const throttled = buildPcmProbeLogLine(
      state,
      {
        channels: 1,
        data: float32Buffer([0.25, -0.25]),
        sampleRate: 16_000,
        timestamp: 0.05,
      },
      { encoding: 'float32', nowMs: 1_200 }
    )
    state = throttled.state

    const second = buildPcmProbeLogLine(
      state,
      {
        channels: 1,
        data: float32Buffer([0.25, -0.25]),
        sampleRate: 16_000,
        timestamp: 1,
      },
      { encoding: 'float32', nowMs: 2_200 }
    )

    expect(first.line).toContain('rms=0.354')
    expect(throttled.line).toBeNull()
    expect(second.line).toContain('frames=2')
    expect(second.line).toContain('fps=1.7')
  })
})
