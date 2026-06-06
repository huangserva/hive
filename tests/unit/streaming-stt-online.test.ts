import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  __resetStreamingRecognizerCacheForTests,
  createStreamingRecognitionSession,
  resampleInt16PcmTo16kFloat32,
  resolveStreamingParaformerModel,
} from '../../src/server/streaming-stt-online.js'

const makeHomeWithModel = () => {
  const home = mkdtempSync(join(tmpdir(), 'hive-streaming-stt-home-'))
  const modelDir = join(home, '.config', 'hive', 'streaming-paraformer')
  mkdirSync(modelDir, { recursive: true })
  writeFileSync(join(modelDir, 'encoder.int8.onnx'), 'encoder')
  writeFileSync(join(modelDir, 'decoder.int8.onnx'), 'decoder')
  writeFileSync(join(modelDir, 'tokens.txt'), 'tokens')
  return { home, modelDir }
}

const makeEnv = (home: string): NodeJS.ProcessEnv => ({ ...process.env, HOME: home })

describe('streaming STT online recognizer', () => {
  afterEach(() => {
    __resetStreamingRecognizerCacheForTests()
    vi.restoreAllMocks()
  })

  test('resolves the default streaming Paraformer model only when all files exist', () => {
    const emptyHome = mkdtempSync(join(tmpdir(), 'hive-streaming-stt-empty-'))
    expect(resolveStreamingParaformerModel(makeEnv(emptyHome))).toBeNull()

    const { home, modelDir } = makeHomeWithModel()

    expect(resolveStreamingParaformerModel(makeEnv(home))).toEqual({
      decoder: join(modelDir, 'decoder.int8.onnx'),
      encoder: join(modelDir, 'encoder.int8.onnx'),
      tokens: join(modelDir, 'tokens.txt'),
    })

    rmSync(emptyHome, { force: true, recursive: true })
    rmSync(home, { force: true, recursive: true })
  })

  test('returns null when the streaming model is unavailable', async () => {
    const emptyHome = mkdtempSync(join(tmpdir(), 'hive-streaming-stt-empty-'))

    await expect(
      createStreamingRecognitionSession(
        'call-1',
        {
          onFinal: async () => {},
        },
        {
          env: makeEnv(emptyHome),
          loadSherpaOnnx: async () => {
            throw new Error('should not load without model')
          },
        }
      )
    ).resolves.toBeNull()

    rmSync(emptyHome, { force: true, recursive: true })
  })

  test('decodes pushed frames, emits endpoint finals, and resets the stream', async () => {
    const { home } = makeHomeWithModel()
    const accepted: Array<{ sampleRate: number; samples: Float32Array }> = []
    const resets: unknown[] = []
    const partials: string[] = []
    const finals: string[] = []
    const stream = {
      acceptWaveform(sampleRate: number, samples: Float32Array) {
        accepted.push({ sampleRate, samples })
      },
    }
    const acceptWaveformSpy = vi.spyOn(stream, 'acceptWaveform')
    const recognizer = {
      createStream: () => stream,
      decode: vi.fn(),
      getResult: vi.fn(() => ({ text: '你好世界' })),
      isEndpoint: vi.fn(() => true),
      isReady: vi.fn().mockReturnValueOnce(true).mockReturnValue(false),
      reset: vi.fn((currentStream: unknown) => resets.push(currentStream)),
    }

    const session = await createStreamingRecognitionSession(
      'call-1',
      {
        onFinal: async (text) => {
          finals.push(text)
        },
        onPartial: (text) => partials.push(text),
      },
      {
        env: makeEnv(home),
        loadSherpaOnnx: async () => ({
          createOnlineRecognizer: () => recognizer,
        }),
      }
    )
    expect(session).not.toBeNull()

    session?.pushFrame(Buffer.from(Int16Array.from([0, 16_000, -16_000]).buffer), 48_000, 16)
    await vi.waitFor(() => expect(finals).toEqual(['你好世界']))

    expect(accepted).toHaveLength(1)
    expect(accepted[0]?.sampleRate).toBe(16_000)
    expect(acceptWaveformSpy).toHaveBeenCalledWith(16_000, expect.any(Float32Array))
    expect(recognizer.decode).toHaveBeenCalledWith(stream)
    expect(partials).toEqual(['你好世界'])
    expect(resets).toEqual([stream])

    rmSync(home, { force: true, recursive: true })
  })

  test('does not finalize without endpoint, but flush emits the remaining result', async () => {
    const { home } = makeHomeWithModel()
    const finals: string[] = []
    const recognizer = {
      createStream: () => ({
        acceptWaveform: vi.fn(),
      }),
      decode: vi.fn(),
      getResult: vi.fn(() => ({ text: '还没断句' })),
      isEndpoint: vi.fn(() => false),
      isReady: vi.fn().mockReturnValueOnce(true).mockReturnValue(false),
      reset: vi.fn(),
    }
    const session = await createStreamingRecognitionSession(
      'call-1',
      {
        onFinal: async (text) => {
          finals.push(text)
        },
      },
      {
        env: makeEnv(home),
        loadSherpaOnnx: async () => ({
          createOnlineRecognizer: () => recognizer,
        }),
      }
    )

    session?.pushFrame(Buffer.from(Int16Array.from([10, 20, 30]).buffer), 16_000, 16)
    await Promise.resolve()
    expect(finals).toEqual([])

    await session?.flush()

    expect(finals).toEqual(['还没断句'])
    expect(recognizer.reset).toHaveBeenCalledTimes(1)

    rmSync(home, { force: true, recursive: true })
  })

  test('does not decode pushed frames until the online recognizer is ready', async () => {
    const { home } = makeHomeWithModel()
    const errors: unknown[] = []
    const recognizer = {
      createStream: () => ({
        acceptWaveform: vi.fn(),
      }),
      decode: vi.fn(() => {
        throw new Error('decode must not run before isReady')
      }),
      getResult: vi.fn(() => ({ text: '' })),
      isEndpoint: vi.fn(() => false),
      isReady: vi.fn(() => false),
      reset: vi.fn(),
    }
    const session = await createStreamingRecognitionSession(
      'call-not-ready',
      {
        onError: (error) => errors.push(error),
        onFinal: async () => {},
      },
      {
        env: makeEnv(home),
        loadSherpaOnnx: async () => ({
          createOnlineRecognizer: () => recognizer,
        }),
      }
    )

    session?.pushFrame(Buffer.from(Int16Array.from([10, 20, 30]).buffer), 16_000, 16)

    expect(recognizer.isReady).toHaveBeenCalled()
    expect(recognizer.decode).not.toHaveBeenCalled()
    expect(errors).toEqual([])

    rmSync(home, { force: true, recursive: true })
  })

  test('flush marks input finished, drains ready frames, and emits the remaining result', async () => {
    const { home } = makeHomeWithModel()
    const finals: string[] = []
    const stream = {
      acceptWaveform: vi.fn(),
      inputFinished: vi.fn(),
    }
    const recognizer = {
      createStream: () => stream,
      decode: vi.fn(),
      getResult: vi.fn(() => ({ text: '最后一句' })),
      isEndpoint: vi.fn(() => false),
      isReady: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false),
      reset: vi.fn(),
    }
    const session = await createStreamingRecognitionSession(
      'call-flush-drain',
      {
        onFinal: async (text) => {
          finals.push(text)
        },
      },
      {
        env: makeEnv(home),
        loadSherpaOnnx: async () => ({
          createOnlineRecognizer: () => recognizer,
        }),
      }
    )

    await session?.flush()

    expect(stream.inputFinished).toHaveBeenCalledTimes(1)
    expect(recognizer.decode).toHaveBeenCalledTimes(2)
    expect(finals).toEqual(['最后一句'])
    expect(recognizer.reset).toHaveBeenCalledTimes(1)

    rmSync(home, { force: true, recursive: true })
  })

  test('retires a replaced recognizer and frees it after its active session closes', async () => {
    const first = makeHomeWithModel()
    const second = makeHomeWithModel()
    writeFileSync(join(second.modelDir, 'encoder.int8.onnx'), 'encoder-b')
    const firstFree = vi.fn()
    const secondFree = vi.fn()
    const makeRecognizer = (free: () => void) => ({
      createStream: () => ({ acceptWaveform: vi.fn(), free: vi.fn() }),
      decode: vi.fn(),
      free,
      getResult: vi.fn(() => ({ text: '' })),
      isEndpoint: vi.fn(() => false),
      isReady: vi.fn(() => false),
      reset: vi.fn(),
    })
    const recognizers = [makeRecognizer(firstFree), makeRecognizer(secondFree)]

    const firstSession = await createStreamingRecognitionSession(
      'call-a',
      { onFinal: async () => {} },
      {
        env: makeEnv(first.home),
        loadSherpaOnnx: async () => ({
          createOnlineRecognizer: () => recognizers.shift() ?? makeRecognizer(vi.fn()),
        }),
      }
    )
    const secondSession = await createStreamingRecognitionSession(
      'call-b',
      { onFinal: async () => {} },
      {
        env: makeEnv(second.home),
        loadSherpaOnnx: async () => ({
          createOnlineRecognizer: () => recognizers.shift() ?? makeRecognizer(vi.fn()),
        }),
      }
    )

    expect(firstFree).not.toHaveBeenCalled()
    firstSession?.close()
    expect(firstFree).toHaveBeenCalledTimes(1)
    expect(secondFree).not.toHaveBeenCalled()
    secondSession?.close()
    expect(secondFree).not.toHaveBeenCalled()

    rmSync(first.home, { force: true, recursive: true })
    rmSync(second.home, { force: true, recursive: true })
  })

  test('resamples 48kHz int16 PCM to 16kHz normalized float samples', () => {
    const pcm = Int16Array.from([0, 3000, 6000, 9000, 12_000, 15_000])
    const output = resampleInt16PcmTo16kFloat32(Buffer.from(pcm.buffer), 48_000, 16)

    expect(output).toHaveLength(2)
    expect(output[0]).toBeCloseTo(0)
    expect(output[1]).toBeCloseTo(9000 / 32768)
    expect([...output].every((sample) => sample >= -1 && sample <= 1)).toBe(true)
  })
})
