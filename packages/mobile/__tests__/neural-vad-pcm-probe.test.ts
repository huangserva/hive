import Constants from 'expo-constants'
import { describe, expect, test, vi } from 'vitest'

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }))

import {
  buildPcmProbeLogLine,
  buildSileroModelInput,
  buildSileroShadowLogLine,
  createInitialPcmProbeLogState,
  createInitialSileroModelState,
  createInitialSileroShadowFrameState,
  extractSileroShadowFrames,
  resolveNeuralVadPcmProbeEnabled,
  resolveNeuralVadShadowEnabled,
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

  test('enables PCM probe from Expo config extra before env fallback', () => {
    expect(resolveNeuralVadPcmProbeEnabled({}, { neuralVadPcmProbe: '1' })).toBe(true)
    expect(resolveNeuralVadPcmProbeEnabled({}, { neuralVadPcmProbe: true })).toBe(true)
    expect(
      resolveNeuralVadPcmProbeEnabled(
        { EXPO_PUBLIC_NEURAL_VAD_PCM_PROBE: '1' },
        { neuralVadPcmProbe: '0' }
      )
    ).toBe(false)
  })

  test('enables Silero shadow mode by default and allows explicit opt-out', () => {
    expect(resolveNeuralVadShadowEnabled({})).toBe(true)
    expect(resolveNeuralVadShadowEnabled({ EXPO_PUBLIC_NEURAL_VAD_SHADOW: '0' })).toBe(false)
    expect(resolveNeuralVadShadowEnabled({ EXPO_PUBLIC_NEURAL_VAD_SHADOW: '1' })).toBe(true)
    expect(resolveNeuralVadShadowEnabled({ EXPO_PUBLIC_NEURAL_VAD_SHADOW: 'true' })).toBe(true)
  })

  test('enables Silero shadow from Expo config extra before env fallback', () => {
    expect(resolveNeuralVadShadowEnabled({}, { neuralVadShadow: '1' })).toBe(true)
    expect(resolveNeuralVadShadowEnabled({}, { neuralVadShadow: true })).toBe(true)
    expect(
      resolveNeuralVadShadowEnabled(
        { EXPO_PUBLIC_NEURAL_VAD_SHADOW: '1' },
        { neuralVadShadow: '0' }
      )
    ).toBe(false)
  })

  test('reads default runtime flags from Expo config extra', () => {
    Constants.expoConfig = {
      extra: {
        neuralVadPcmProbe: '1',
        neuralVadShadow: '1',
      },
    } as unknown as typeof Constants.expoConfig

    expect(resolveNeuralVadPcmProbeEnabled({})).toBe(true)
    expect(resolveNeuralVadShadowEnabled({})).toBe(true)
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

  test('splits int16 PCM into 512-sample Silero frames without dropping residual samples', () => {
    let state = createInitialSileroShadowFrameState()
    const firstSamples = Array.from({ length: 300 }, (_, index) => index)
    const first = extractSileroShadowFrames(state, int16Buffer(firstSamples))
    state = first.state

    expect(first.frames).toHaveLength(0)
    expect(state.pendingSamples).toHaveLength(300)

    const secondSamples = Array.from({ length: 300 }, (_, index) => 300 + index)
    const second = extractSileroShadowFrames(state, int16Buffer(secondSamples))

    expect(second.frames).toHaveLength(1)
    expect(second.frames[0]?.index).toBe(1)
    expect(second.frames[0]?.samples).toHaveLength(512)
    expect(second.frames[0]?.samples[0]).toBeCloseTo(0)
    expect(second.frames[0]?.samples[511]).toBeCloseTo(511 / 32768)
    expect(second.state.pendingSamples).toHaveLength(88)
    expect(second.state.nextFrameIndex).toBe(2)
  })

  test('formats Silero shadow probability logs with frame index and energy', () => {
    const line = buildSileroShadowLogLine({
      frameIndex: 7,
      probability: 0.9342,
      rms: 0.1234,
      sampleRate: 16_000,
    })

    expect(line).toContain('[SILERODBG]')
    expect(line).toContain('voice_prob=0.934')
    expect(line).toContain('frame=7')
    expect(line).toContain('rms=0.123')
    expect(line).toContain('sr=16000Hz')
  })

  test('builds Silero model input with 64-sample context and updates context tail', () => {
    let state = createInitialSileroModelState()
    const frame = new Float32Array(Array.from({ length: 512 }, (_, index) => index / 512))
    const input = buildSileroModelInput(state, frame)
    state = input.state

    expect(input.samples).toHaveLength(576)
    expect(input.samples[0]).toBe(0)
    expect(input.samples[63]).toBe(0)
    expect(input.samples[64]).toBeCloseTo(0)
    expect(input.samples[575]).toBeCloseTo(511 / 512)
    expect(state.context).toHaveLength(64)
    expect(state.context[0]).toBeCloseTo(448 / 512)
    expect(state.context[63]).toBeCloseTo(511 / 512)
  })
})
