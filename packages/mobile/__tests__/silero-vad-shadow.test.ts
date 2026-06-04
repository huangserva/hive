import { describe, expect, test, vi } from 'vitest'

vi.mock('onnxruntime-react-native', () => ({}))
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }))

import type { SileroShadowFrame } from '../src/lib/neural-vad-pcm-probe'
import { createSileroVadShadowScorer } from '../src/lib/silero-vad-shadow'

const frame = (index = 1): SileroShadowFrame => ({
  index,
  rms: 0,
  samples: new Float32Array(512),
})

describe('Silero VAD shadow scorer', () => {
  test('disables shadow scoring instead of throwing when onnxruntime resolves to null', async () => {
    const loadOrt = vi.fn(async () => null)
    const log = vi.fn()
    const scorer = createSileroVadShadowScorer({
      hasNativeOrtModule: async () => true,
      loadOrt,
      logScoreFailed: log,
    })

    await expect(scorer.score(frame())).resolves.toBeNull()
    await expect(scorer.score(frame(2))).resolves.toBeNull()

    expect(loadOrt).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]).toContain('[SILERODBG] score_failed')
  })

  test('does not import onnxruntime when the native Onnxruntime module is missing', async () => {
    const loadOrt = vi.fn(async () => {
      throw new Error('onnxruntime import must not run without native module')
    })
    const log = vi.fn()
    const scorer = createSileroVadShadowScorer({
      hasNativeOrtModule: async () => false,
      loadOrt,
      logScoreFailed: log,
    })

    await expect(scorer.score(frame())).resolves.toBeNull()
    await expect(scorer.score(frame(2))).resolves.toBeNull()

    expect(loadOrt).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]).toContain('neural_unavailable')
  })

  test('disables shadow scoring instead of throwing when onnxruntime import rejects during module init', async () => {
    const loadOrt = vi.fn(async () => {
      throw new TypeError('Cannot read property "install" of null')
    })
    const log = vi.fn()
    const scorer = createSileroVadShadowScorer({
      hasNativeOrtModule: async () => true,
      loadOrt,
      logScoreFailed: log,
    })

    await expect(scorer.score(frame())).resolves.toBeNull()
    await expect(scorer.score(frame(2))).resolves.toBeNull()

    expect(loadOrt).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]).toContain('install')
  })

  test('disables shadow scoring instead of throwing when inference fails', async () => {
    class Tensor {
      data: unknown

      constructor(_type: string, data: unknown) {
        this.data = data
      }
    }
    const session = {
      run: vi.fn(async () => {
        throw new Error('native inference failed')
      }),
    }
    const loadOrt = vi.fn(async () => ({
      InferenceSession: {
        create: vi.fn(async () => session),
      },
      Tensor,
    }))
    const log = vi.fn()
    const scorer = createSileroVadShadowScorer({
      hasNativeOrtModule: async () => true,
      loadModelUri: async () => 'file:///tmp/silero_vad.onnx',
      loadOrt,
      logScoreFailed: log,
    })

    await expect(scorer.score(frame())).resolves.toBeNull()
    await expect(scorer.score(frame(2))).resolves.toBeNull()

    expect(session.run).toHaveBeenCalledTimes(1)
    expect(loadOrt).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]).toContain('native inference failed')
  })
})
