import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  __resetParaformerRecognizerCacheForTests,
  createLocalSttProvider,
} from '../../src/server/local-stt.js'

const tempDirs: string[] = []

afterEach(() => {
  __resetParaformerRecognizerCacheForTests()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const setupDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

const writeExecutable = (dir: string, name: string, source: string) => {
  const file = join(dir, name)
  writeFileSync(file, source, 'utf8')
  chmodSync(file, 0o755)
  return file
}

const nodeScript = (body: string) => `#!/usr/bin/env node
${body}
`

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

describe('LocalSttProvider', () => {
  test('returns null when no supported local STT CLI is available', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const homeDir = setupDir('hive-stt-home-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const audioPath = join(tempRoot, 'voice.ogg')
    writeFileSync(audioPath, 'audio bytes')

    const provider = createLocalSttProvider({
      env: { HOME: homeDir, PATH: binDir },
      tempRoot,
    })

    await expect(provider.detect()).resolves.toBeNull()
    await expect(provider.transcribeAudioFile(audioPath)).resolves.toBeNull()
  })

  test('runs Python whisper CLI, reads generated txt, and cleans output directory', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const audioPath = join(tempRoot, 'voice.ogg')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'whisper',
      nodeScript(`
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join, parse } from 'node:path'
const args = process.argv.slice(2)
const outputDir = args[args.indexOf('--output_dir') + 1]
const prompt = args[args.indexOf('--initial_prompt') + 1]
const language = args[args.indexOf('--language') + 1]
const mediaPath = args.at(-1)
if (!mediaPath || basename(mediaPath) !== 'voice.ogg') process.exit(3)
if (!prompt?.includes('简体中文普通话语音指令')) process.exit(4)
if (!prompt?.includes('关羽') || !prompt?.includes('马超')) process.exit(5)
if (language !== 'zh') process.exit(6)
mkdirSync(outputDir, { recursive: true })
writeFileSync(join(outputDir, parse(mediaPath).name + '.txt'), ' local whisper transcript \\n')
`)
    )

    const provider = createLocalSttProvider({
      env: { PATH: binDir },
      tempRoot,
    })

    const result = await provider.transcribeAudioFile(audioPath)

    expect(result).toEqual({
      provider: 'whisper',
      text: 'local whisper transcript',
    })
    expect(readdirSync(tempRoot).filter((name) => name.startsWith('hive-local-stt-'))).toEqual([])
  })

  test('prefers whisper-cli when a whisper.cpp model path is configured', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const modelPath = join(tempRoot, 'ggml-small.bin')
    const audioPath = join(tempRoot, 'voice.m4a')
    writeFileSync(modelPath, 'model')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'ffmpeg',
      nodeScript(`
import { writeFileSync } from 'node:fs'
import { basename } from 'node:path'
const args = process.argv.slice(2)
const input = args[args.indexOf('-i') + 1]
const output = args.at(-1)
if (!input.endsWith('voice.m4a')) process.exit(5)
if (args[args.indexOf('-ar') + 1] !== '16000') process.exit(6)
if (args[args.indexOf('-ac') + 1] !== '1') process.exit(7)
if (args[args.indexOf('-c:a') + 1] !== 'pcm_s16le') process.exit(8)
if (!output || !basename(output).endsWith('.wav')) process.exit(9)
writeFileSync(output, 'converted wav bytes')
`)
    )
    writeExecutable(
      binDir,
      'whisper-cli',
      nodeScript(`
import { writeFileSync } from 'node:fs'
import { basename } from 'node:path'
const args = process.argv.slice(2)
const model = args[args.indexOf('-m') + 1]
const language = args[args.indexOf('-l') + 1]
const outputBase = args[args.indexOf('-of') + 1]
const prompt = args[args.indexOf('--prompt') + 1]
const mediaPath = args.at(-1)
if (!model.endsWith('ggml-small.bin')) process.exit(4)
if (language !== 'zh') process.exit(13)
if (!mediaPath || basename(mediaPath) !== 'voice.wav') process.exit(10)
if (!prompt?.includes('简体中文普通话语音指令')) process.exit(11)
if (!prompt?.includes('赵云') || !prompt?.includes('钟馗')) process.exit(12)
writeFileSync(outputBase + '.txt', 'whisper cpp transcript')
`)
    )
    writeExecutable(binDir, 'whisper', nodeScript("console.log('wrong backend')\n"))

    const provider = createLocalSttProvider({
      env: { PATH: binDir, WHISPER_CPP_MODEL: modelPath },
      tempRoot,
    })

    const result = await provider.transcribeAudioFile(audioPath)

    expect(result).toEqual({
      provider: 'whisper-cli',
      text: 'whisper cpp transcript',
    })
  })

  test('prefers Paraformer when sherpa-onnx model paths are configured', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const modelDir = setupDir('hive-stt-paraformer-')
    const audioPath = join(tempRoot, 'voice.m4a')
    const model = join(modelDir, 'model.int8.onnx')
    const tokens = join(modelDir, 'tokens.txt')
    writeFileSync(model, 'paraformer model')
    writeFileSync(tokens, 'tokens')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'ffmpeg',
      nodeScript(`
import { writeFileSync } from 'node:fs'
import { basename } from 'node:path'
const args = process.argv.slice(2)
const input = args[args.indexOf('-i') + 1]
const output = args.at(-1)
if (!input.endsWith('voice.m4a')) process.exit(5)
if (args[args.indexOf('-ar') + 1] !== '16000') process.exit(6)
if (args[args.indexOf('-ac') + 1] !== '1') process.exit(7)
if (args[args.indexOf('-c:a') + 1] !== 'pcm_s16le') process.exit(8)
if (!output || basename(output) !== 'voice.wav') process.exit(9)
writeFileSync(output, 'converted wav bytes')
`)
    )
    writeExecutable(binDir, 'whisper', nodeScript("throw new Error('whisper should not run')\n"))

    const provider = createLocalSttProvider({
      env: {
        HIVE_STT_PARAFORMER_MODEL: model,
        HIVE_STT_PARAFORMER_TOKENS: tokens,
        PATH: binDir,
      },
      loadSherpaOnnx: async () => ({
        OfflineRecognizer: class {
          constructor(config: unknown) {
            expect(config).toMatchObject({
              modelConfig: {
                paraformer: {
                  model,
                },
                tokens,
              },
            })
          }

          createStream() {
            return {
              acceptWaveFile: (path: string) => {
                expect(path.endsWith('voice.wav')).toBe(true)
              },
            }
          }

          decode(stream: unknown) {
            expect(stream).toBeTruthy()
          }

          getResult() {
            return { text: '让关羽汇报进度' }
          }
        },
      }),
      tempRoot,
    })

    await expect(provider.detect()).resolves.toMatchObject({ provider: 'paraformer' })
    await expect(provider.transcribeAudioFile(audioPath)).resolves.toEqual({
      provider: 'paraformer',
      text: '让关羽汇报进度',
    })
  })

  test('discovers Paraformer models from the default hive model directory', async () => {
    const homeDir = setupDir('hive-stt-home-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const modelDir = join(homeDir, '.config', 'hive', 'paraformer-models')
    mkdirSync(modelDir, { recursive: true })
    writeFileSync(join(modelDir, 'model.int8.onnx'), 'model')
    writeFileSync(join(modelDir, 'tokens.txt'), 'tokens')

    const provider = createLocalSttProvider({
      env: { HOME: homeDir, PATH: setupDir('hive-stt-bin-') },
      loadSherpaOnnx: async () => ({
        OfflineRecognizer: class {
          createStream() {
            return { acceptWaveFile: () => {} }
          }
          decode() {}
          getResult() {
            return { text: 'ok' }
          }
        },
      }),
      tempRoot,
    })

    await expect(provider.detect()).resolves.toMatchObject({
      model: join(modelDir, 'model.int8.onnx'),
      provider: 'paraformer',
      tokens: join(modelDir, 'tokens.txt'),
    })
  })

  test('falls back to whisper when Paraformer recognition fails', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const modelDir = setupDir('hive-stt-paraformer-')
    const audioPath = join(tempRoot, 'voice.ogg')
    const model = join(modelDir, 'model.onnx')
    const tokens = join(modelDir, 'tokens.txt')
    const logger = { warn: vi.fn() }
    writeFileSync(model, 'paraformer model')
    writeFileSync(tokens, 'tokens')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'whisper',
      nodeScript(`
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, parse } from 'node:path'
const args = process.argv.slice(2)
const outputDir = args[args.indexOf('--output_dir') + 1]
const mediaPath = args.at(-1)
mkdirSync(outputDir, { recursive: true })
writeFileSync(join(outputDir, parse(mediaPath).name + '.txt'), 'fallback transcript')
`)
    )

    const provider = createLocalSttProvider({
      env: {
        HIVE_STT_PARAFORMER_MODEL: model,
        HIVE_STT_PARAFORMER_TOKENS: tokens,
        PATH: binDir,
      },
      loadSherpaOnnx: async () => {
        throw new Error('sherpa unavailable')
      },
      logger,
      tempRoot,
    })

    await expect(provider.transcribeAudioFile(audioPath)).resolves.toEqual({
      provider: 'whisper',
      text: 'fallback transcript',
    })
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('local STT failed provider=paraformer'),
      expect.any(Error)
    )
  })

  test('keeps no-speech sanitization on Paraformer output as defense in depth', async () => {
    const tempRoot = setupDir('hive-stt-tmp-')
    const modelDir = setupDir('hive-stt-paraformer-')
    const audioPath = join(tempRoot, 'voice.wav')
    const model = join(modelDir, 'model.onnx')
    const tokens = join(modelDir, 'tokens.txt')
    const binDir = setupDir('hive-stt-bin-')
    writeFileSync(model, 'paraformer model')
    writeFileSync(tokens, 'tokens')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'ffmpeg',
      nodeScript(`
import { writeFileSync } from 'node:fs'
writeFileSync(process.argv.at(-1), 'converted wav bytes')
`)
    )

    const provider = createLocalSttProvider({
      env: {
        HIVE_STT_PARAFORMER_MODEL: model,
        HIVE_STT_PARAFORMER_TOKENS: tokens,
        PATH: binDir,
      },
      loadSherpaOnnx: async () => ({
        OfflineRecognizer: class {
          createStream() {
            return { acceptWaveFile: () => {} }
          }
          decode() {}
          getResult() {
            return { text: '团队成员关羽马超赵云钟馗吕布典韦张飞周瑜' }
          }
        },
      }),
      tempRoot,
    })

    await expect(provider.transcribeAudioFile(audioPath)).resolves.toBeNull()
  })

  test('drops conservative Paraformer gibberish before returning a transcript', async () => {
    const tempRoot = setupDir('hive-stt-tmp-')
    const modelDir = setupDir('hive-stt-paraformer-')
    const audioPath = join(tempRoot, 'voice.wav')
    const model = join(modelDir, 'model.onnx')
    const tokens = join(modelDir, 'tokens.txt')
    const binDir = setupDir('hive-stt-bin-')
    const logger = { info: vi.fn(), warn: vi.fn() }
    writeFileSync(model, 'paraformer model')
    writeFileSync(tokens, 'tokens')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'ffmpeg',
      nodeScript(`
import { writeFileSync } from 'node:fs'
writeFileSync(process.argv.at(-1), 'converted wav bytes')
`)
    )

    const provider = createLocalSttProvider({
      env: {
        HIVE_STT_PARAFORMER_MODEL: model,
        HIVE_STT_PARAFORMER_TOKENS: tokens,
        NODE_ENV: 'test',
        PATH: binDir,
      },
      loadSherpaOnnx: async () => ({
        OfflineRecognizer: class {
          createStream() {
            return { acceptWaveFile: () => {} }
          }
          decode() {}
          getResult() {
            return { text: '你有没有奶还个要的哎我是十那个推荐你去牛奶' }
          }
        },
      }),
      logger,
      tempRoot,
    })

    await expect(provider.transcribeAudioFile(audioPath)).resolves.toBeNull()
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('decision=drop reason=conservative_gibberish_text')
    )
  })

  test('allows ordinary Paraformer Chinese transcript while logging the quality decision', async () => {
    const tempRoot = setupDir('hive-stt-tmp-')
    const modelDir = setupDir('hive-stt-paraformer-')
    const audioPath = join(tempRoot, 'voice.wav')
    const model = join(modelDir, 'model.onnx')
    const tokens = join(modelDir, 'tokens.txt')
    const binDir = setupDir('hive-stt-bin-')
    const logger = { info: vi.fn(), warn: vi.fn() }
    writeFileSync(model, 'paraformer model')
    writeFileSync(tokens, 'tokens')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'ffmpeg',
      nodeScript(`
import { writeFileSync } from 'node:fs'
writeFileSync(process.argv.at(-1), 'converted wav bytes')
`)
    )

    const provider = createLocalSttProvider({
      env: {
        HIVE_STT_PARAFORMER_MODEL: model,
        HIVE_STT_PARAFORMER_TOKENS: tokens,
        NODE_ENV: 'test',
        PATH: binDir,
      },
      loadSherpaOnnx: async () => ({
        OfflineRecognizer: class {
          createStream() {
            return { acceptWaveFile: () => {} }
          }
          decode() {}
          getResult() {
            return { text: '让关羽汇报一下 WebRTC 通话进度' }
          }
        },
      }),
      logger,
      tempRoot,
    })

    await expect(provider.transcribeAudioFile(audioPath)).resolves.toEqual({
      provider: 'paraformer',
      text: '让关羽汇报一下 WebRTC 通话进度',
    })
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('decision=allow reason=text_quality_ok')
    )
  })

  test('reuses the Paraformer recognizer across repeated transcriptions for the same model', async () => {
    const tempRoot = setupDir('hive-stt-tmp-')
    const modelDir = setupDir('hive-stt-paraformer-')
    const audioPath = join(tempRoot, 'voice.wav')
    const model = join(modelDir, 'model.onnx')
    const tokens = join(modelDir, 'tokens.txt')
    const binDir = setupDir('hive-stt-bin-')
    const createdStreams: Array<{ freed: boolean }> = []
    let loadSherpaOnnxCount = 0
    let recognizerConstructCount = 0
    writeFileSync(model, 'paraformer model')
    writeFileSync(tokens, 'tokens')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'ffmpeg',
      nodeScript(`
import { writeFileSync } from 'node:fs'
writeFileSync(process.argv.at(-1), 'converted wav bytes')
`)
    )

    const provider = createLocalSttProvider({
      env: {
        HIVE_STT_PARAFORMER_MODEL: model,
        HIVE_STT_PARAFORMER_TOKENS: tokens,
        PATH: binDir,
      },
      loadSherpaOnnx: async () => {
        loadSherpaOnnxCount += 1
        return {
          OfflineRecognizer: class {
            constructor() {
              recognizerConstructCount += 1
            }

            createStream() {
              const stream = {
                acceptWaveFile: () => {},
                freed: false,
                free() {
                  stream.freed = true
                },
              }
              createdStreams.push(stream)
              return stream
            }

            decode() {}
            getResult() {
              return { text: '让关羽汇报进度' }
            }
          },
        }
      },
      tempRoot,
    })

    await expect(provider.transcribeAudioFile(audioPath)).resolves.toEqual({
      provider: 'paraformer',
      text: '让关羽汇报进度',
    })
    await expect(provider.transcribeAudioFile(audioPath)).resolves.toEqual({
      provider: 'paraformer',
      text: '让关羽汇报进度',
    })

    expect(loadSherpaOnnxCount).toBe(1)
    expect(recognizerConstructCount).toBe(1)
    expect(createdStreams).toHaveLength(2)
    expect(createdStreams.every((stream) => stream.freed)).toBe(true)
  })

  test('reuses the Paraformer recognizer across provider instances for request-scoped STT entrypoints', async () => {
    const tempRoot = setupDir('hive-stt-tmp-')
    const modelDir = setupDir('hive-stt-paraformer-')
    const audioPath = join(tempRoot, 'voice.wav')
    const model = join(modelDir, 'model.onnx')
    const tokens = join(modelDir, 'tokens.txt')
    const binDir = setupDir('hive-stt-bin-')
    let loadSherpaOnnxCount = 0
    let recognizerConstructCount = 0
    writeFileSync(model, 'paraformer model')
    writeFileSync(tokens, 'tokens')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'ffmpeg',
      nodeScript(`
import { writeFileSync } from 'node:fs'
writeFileSync(process.argv.at(-1), 'converted wav bytes')
`)
    )
    const env = {
      HIVE_STT_PARAFORMER_MODEL: model,
      HIVE_STT_PARAFORMER_TOKENS: tokens,
      PATH: binDir,
    }
    const loadSherpaOnnx = async () => {
      loadSherpaOnnxCount += 1
      return {
        OfflineRecognizer: class {
          constructor() {
            recognizerConstructCount += 1
          }

          createStream() {
            return {
              acceptWaveFile: () => {},
              free: () => {},
            }
          }

          decode() {}
          getResult() {
            return { text: '叫张飞去测试' }
          }
        },
      }
    }

    const firstProvider = createLocalSttProvider({ env, loadSherpaOnnx, tempRoot })
    const secondProvider = createLocalSttProvider({ env, loadSherpaOnnx, tempRoot })

    await expect(firstProvider.transcribeAudioFile(audioPath)).resolves.toEqual({
      provider: 'paraformer',
      text: '叫张飞去测试',
    })
    await expect(secondProvider.transcribeAudioFile(audioPath)).resolves.toEqual({
      provider: 'paraformer',
      text: '叫张飞去测试',
    })

    expect(loadSherpaOnnxCount).toBe(1)
    expect(recognizerConstructCount).toBe(1)
  })

  test('deduplicates concurrent Paraformer recognizer loads per model key across provider instances', async () => {
    const tempRoot = setupDir('hive-stt-tmp-')
    const modelDir = setupDir('hive-stt-paraformer-')
    const binDir = setupDir('hive-stt-bin-')
    const audioPath = join(tempRoot, 'voice.wav')
    const modelA = join(modelDir, 'model-a.onnx')
    const tokensA = join(modelDir, 'tokens-a.txt')
    const modelB = join(modelDir, 'model-b.onnx')
    const tokensB = join(modelDir, 'tokens-b.txt')
    writeFileSync(audioPath, 'audio bytes')
    writeFileSync(modelA, 'model a')
    writeFileSync(tokensA, 'tokens a')
    writeFileSync(modelB, 'model b')
    writeFileSync(tokensB, 'tokens b')
    writeExecutable(
      binDir,
      'ffmpeg',
      nodeScript(`
import { writeFileSync } from 'node:fs'
writeFileSync(process.argv.at(-1), 'converted wav bytes')
`)
    )

    const loadCounts = { a: 0, b: 0 }
    const loadA = createDeferred<{
      OfflineRecognizer: new () => {
        createStream: () => { acceptWaveFile: () => void; free: () => void }
        decode: () => void
        getResult: () => { text: string }
      }
    }>()
    const loadB = createDeferred<{
      OfflineRecognizer: new () => {
        createStream: () => { acceptWaveFile: () => void; free: () => void }
        decode: () => void
        getResult: () => { text: string }
      }
    }>()
    const runtimeFor = (text: string) => ({
      OfflineRecognizer: class {
        createStream() {
          return {
            acceptWaveFile: () => {},
            free: () => {},
          }
        }

        decode() {}
        getResult() {
          return { text }
        }
      },
    })
    const makeProvider = (label: 'a' | 'b') =>
      createLocalSttProvider({
        env: {
          HIVE_STT_PARAFORMER_MODEL: label === 'a' ? modelA : modelB,
          HIVE_STT_PARAFORMER_TOKENS: label === 'a' ? tokensA : tokensB,
          PATH: binDir,
        },
        loadSherpaOnnx: async () => {
          loadCounts[label] += 1
          return label === 'a' ? loadA.promise : loadB.promise
        },
        tempRoot,
      })

    const firstA = makeProvider('a').transcribeAudioFile(audioPath)
    const firstB = makeProvider('b').transcribeAudioFile(audioPath)
    const secondA = makeProvider('a').transcribeAudioFile(audioPath)
    await vi.waitFor(() => {
      expect(loadCounts).toEqual({ a: 1, b: 1 })
    })

    loadA.resolve(runtimeFor('让关羽汇报进度'))
    loadB.resolve(runtimeFor('叫张飞去测试'))
    await expect(firstA).resolves.toEqual({
      provider: 'paraformer',
      text: '让关羽汇报进度',
    })
    await expect(secondA).resolves.toEqual({
      provider: 'paraformer',
      text: '让关羽汇报进度',
    })
    await expect(firstB).resolves.toEqual({
      provider: 'paraformer',
      text: '叫张飞去测试',
    })
  })

  test('keeps a retired Paraformer recognizer alive until the active transcription releases it', async () => {
    const tempRoot = setupDir('hive-stt-tmp-')
    const modelDir = setupDir('hive-stt-paraformer-')
    const binDir = setupDir('hive-stt-bin-')
    const audioPath = join(tempRoot, 'voice.wav')
    const modelA = join(modelDir, 'model-a.onnx')
    const tokensA = join(modelDir, 'tokens-a.txt')
    const modelB = join(modelDir, 'model-b.onnx')
    const tokensB = join(modelDir, 'tokens-b.txt')
    writeFileSync(audioPath, 'audio bytes')
    writeFileSync(modelA, 'model a')
    writeFileSync(tokensA, 'tokens a')
    writeFileSync(modelB, 'model b')
    writeFileSync(tokensB, 'tokens b')
    writeExecutable(
      binDir,
      'ffmpeg',
      nodeScript(`
import { writeFileSync } from 'node:fs'
writeFileSync(process.argv.at(-1), 'converted wav bytes')
`)
    )

    const freeCalls: string[] = []
    const runtimeFor = (label: 'a' | 'b', text: string) => ({
      OfflineRecognizer: class {
        createStream() {
          return {
            acceptWaveFile: () => {},
            free: () => {},
          }
        }

        decode() {}
        free() {
          freeCalls.push(label)
        }
        getResult() {
          return { text }
        }
      },
    })
    const makeProvider = (label: 'a' | 'b') =>
      createLocalSttProvider({
        env: {
          HIVE_STT_PARAFORMER_MODEL: label === 'a' ? modelA : modelB,
          HIVE_STT_PARAFORMER_TOKENS: label === 'a' ? tokensA : tokensB,
          PATH: binDir,
        },
        loadSherpaOnnx: async () =>
          label === 'a' ? runtimeFor('a', '让关羽汇报进度') : runtimeFor('b', '叫张飞去测试'),
        tempRoot,
      })

    const aResult = await makeProvider('a').transcribeAudioFile(audioPath)
    expect(aResult?.text).toBe('让关羽汇报进度')
    expect(freeCalls).toEqual([])

    const bResult = await makeProvider('b').transcribeAudioFile(audioPath)
    expect(bResult?.text).toBe('叫张飞去测试')
    expect(freeCalls).toEqual(['a'])
  })

  test('releases a Paraformer recognizer lease even when stream cleanup throws', async () => {
    const tempRoot = setupDir('hive-stt-tmp-')
    const modelDir = setupDir('hive-stt-paraformer-')
    const binDir = setupDir('hive-stt-bin-')
    const audioPath = join(tempRoot, 'voice.wav')
    const modelA = join(modelDir, 'model-a.onnx')
    const tokensA = join(modelDir, 'tokens-a.txt')
    const modelB = join(modelDir, 'model-b.onnx')
    const tokensB = join(modelDir, 'tokens-b.txt')
    writeFileSync(audioPath, 'audio bytes')
    writeFileSync(modelA, 'model a')
    writeFileSync(tokensA, 'tokens a')
    writeFileSync(modelB, 'model b')
    writeFileSync(tokensB, 'tokens b')
    writeExecutable(
      binDir,
      'ffmpeg',
      nodeScript(`
import { writeFileSync } from 'node:fs'
writeFileSync(process.argv.at(-1), 'converted wav bytes')
`)
    )

    const freeCalls: string[] = []
    const runtimeFor = (label: 'a' | 'b', text: string) => ({
      OfflineRecognizer: class {
        createStream() {
          return {
            acceptWaveFile: () => {},
            free: () => {
              if (label === 'a') throw new Error('stream free failed')
            },
          }
        }

        decode() {}
        free() {
          freeCalls.push(label)
        }
        getResult() {
          return { text }
        }
      },
    })
    const makeProvider = (label: 'a' | 'b') =>
      createLocalSttProvider({
        env: {
          HIVE_STT_PARAFORMER_MODEL: label === 'a' ? modelA : modelB,
          HIVE_STT_PARAFORMER_TOKENS: label === 'a' ? tokensA : tokensB,
          PATH: binDir,
        },
        loadSherpaOnnx: async () =>
          label === 'a' ? runtimeFor('a', '让关羽汇报进度') : runtimeFor('b', '叫张飞去测试'),
        tempRoot,
      })

    await expect(makeProvider('a').transcribeAudioFile(audioPath)).resolves.toBeNull()
    expect(freeCalls).toEqual([])

    await expect(makeProvider('b').transcribeAudioFile(audioPath)).resolves.toEqual({
      provider: 'paraformer',
      text: '叫张飞去测试',
    })
    expect(freeCalls).toEqual(['a'])
  })

  test('does not free a just-loaded Paraformer recognizer before its waiting transcription acquires it', async () => {
    const tempRoot = setupDir('hive-stt-tmp-')
    const modelDir = setupDir('hive-stt-paraformer-')
    const binDir = setupDir('hive-stt-bin-')
    const audioPath = join(tempRoot, 'voice.wav')
    const modelA = join(modelDir, 'model-a.onnx')
    const tokensA = join(modelDir, 'tokens-a.txt')
    const modelB = join(modelDir, 'model-b.onnx')
    const tokensB = join(modelDir, 'tokens-b.txt')
    writeFileSync(audioPath, 'audio bytes')
    writeFileSync(modelA, 'model a')
    writeFileSync(tokensA, 'tokens a')
    writeFileSync(modelB, 'model b')
    writeFileSync(tokensB, 'tokens b')
    writeExecutable(
      binDir,
      'ffmpeg',
      nodeScript(`
import { writeFileSync } from 'node:fs'
writeFileSync(process.argv.at(-1), 'converted wav bytes')
`)
    )

    const loadA = createDeferred<{
      OfflineRecognizer: new () => {
        createStream: () => { acceptWaveFile: () => void; free: () => void }
        decode: () => void
        free: () => void
        getResult: () => { text: string }
      }
    }>()
    const loadB = createDeferred<{
      OfflineRecognizer: new () => {
        createStream: () => { acceptWaveFile: () => void; free: () => void }
        decode: () => void
        free: () => void
        getResult: () => { text: string }
      }
    }>()
    const runtimeFor = (text: string) => ({
      OfflineRecognizer: class {
        private freed = false

        createStream() {
          if (this.freed) throw new Error('recognizer was freed before acquire')
          return {
            acceptWaveFile: () => {},
            free: () => {},
          }
        }

        decode() {}
        free() {
          this.freed = true
        }
        getResult() {
          return { text }
        }
      },
    })
    const makeProvider = (label: 'a' | 'b') =>
      createLocalSttProvider({
        env: {
          HIVE_STT_PARAFORMER_MODEL: label === 'a' ? modelA : modelB,
          HIVE_STT_PARAFORMER_TOKENS: label === 'a' ? tokensA : tokensB,
          PATH: binDir,
        },
        loadSherpaOnnx: async () => (label === 'a' ? loadA.promise : loadB.promise),
        tempRoot,
      })

    const firstA = makeProvider('a').transcribeAudioFile(audioPath)
    const firstB = makeProvider('b').transcribeAudioFile(audioPath)
    await Promise.resolve()
    loadA.resolve(runtimeFor('让关羽汇报进度'))
    loadB.resolve(runtimeFor('叫张飞去测试'))

    await expect(firstA).resolves.toEqual({
      provider: 'paraformer',
      text: '让关羽汇报进度',
    })
    await expect(firstB).resolves.toEqual({
      provider: 'paraformer',
      text: '叫张飞去测试',
    })
  })

  test('discovers a whisper.cpp model from the default hive model directory', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const homeDir = setupDir('hive-stt-home-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const modelDir = join(homeDir, '.config', 'hive', 'whisper-models')
    const audioPath = join(tempRoot, 'voice.m4a')
    mkdirSync(modelDir, { recursive: true })
    writeFileSync(join(modelDir, 'ggml-base.bin'), 'model')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'ffmpeg',
      nodeScript(`
import { writeFileSync } from 'node:fs'
const output = process.argv.at(-1)
writeFileSync(output, 'converted wav bytes')
`)
    )
    writeExecutable(
      binDir,
      'whisper-cpp',
      nodeScript(`
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const model = args[args.indexOf('-m') + 1]
const outputBase = args[args.indexOf('-of') + 1]
if (!model.endsWith('ggml-base.bin')) process.exit(4)
writeFileSync(outputBase + '.txt', 'auto model transcript')
`)
    )

    const provider = createLocalSttProvider({
      env: { HOME: homeDir, PATH: binDir },
      tempRoot,
    })

    const detected = await provider.detect()
    const result = await provider.transcribeAudioFile(audioPath)

    expect(detected?.provider).toBe('whisper-cli')
    expect(detected?.command).toContain('whisper-cpp')
    expect(result?.text).toBe('auto model transcript')
  })

  test('uses the first whisper.cpp model by filename when multiple default models exist', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const homeDir = setupDir('hive-stt-home-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const modelDir = join(homeDir, '.config', 'hive', 'whisper-models')
    const audioPath = join(tempRoot, 'voice.m4a')
    mkdirSync(modelDir, { recursive: true })
    writeFileSync(join(modelDir, 'ggml-large.bin'), 'large model')
    writeFileSync(join(modelDir, 'ggml-base.bin'), 'base model')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'ffmpeg',
      nodeScript(`
import { writeFileSync } from 'node:fs'
writeFileSync(process.argv.at(-1), 'converted wav bytes')
`)
    )
    writeExecutable(
      binDir,
      'main',
      nodeScript(`
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const model = args[args.indexOf('-m') + 1]
const outputBase = args[args.indexOf('-of') + 1]
if (!model.endsWith('ggml-base.bin')) process.exit(4)
writeFileSync(outputBase + '.txt', 'sorted model transcript')
`)
    )

    const provider = createLocalSttProvider({
      env: { HOME: homeDir, PATH: binDir },
      tempRoot,
    })

    const result = await provider.transcribeAudioFile(audioPath)

    expect(result?.text).toBe('sorted model transcript')
  })

  test('prefers configured whisper.cpp model over default hive model discovery', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const homeDir = setupDir('hive-stt-home-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const modelDir = join(homeDir, '.config', 'hive', 'whisper-models')
    const configuredModel = join(tempRoot, 'ggml-configured.bin')
    const audioPath = join(tempRoot, 'voice.m4a')
    mkdirSync(modelDir, { recursive: true })
    writeFileSync(join(modelDir, 'ggml-base.bin'), 'home model')
    writeFileSync(configuredModel, 'configured model')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'ffmpeg',
      nodeScript(`
import { writeFileSync } from 'node:fs'
writeFileSync(process.argv.at(-1), 'converted wav bytes')
`)
    )
    writeExecutable(
      binDir,
      'whisper-cli',
      nodeScript(`
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const model = args[args.indexOf('-m') + 1]
const outputBase = args[args.indexOf('-of') + 1]
if (!model.endsWith('ggml-configured.bin')) process.exit(4)
writeFileSync(outputBase + '.txt', 'configured model transcript')
`)
    )

    const provider = createLocalSttProvider({
      env: { HOME: homeDir, PATH: binDir, WHISPER_CPP_MODEL: configuredModel },
      tempRoot,
    })

    const result = await provider.transcribeAudioFile(audioPath)

    expect(result?.text).toBe('configured model transcript')
  })

  test('ignores an unreadable default model directory without crashing detection', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const homeDir = setupDir('hive-stt-home-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const modelDir = join(homeDir, '.config', 'hive', 'whisper-models')
    const logger = { warn: vi.fn() }
    mkdirSync(join(homeDir, '.config', 'hive'), { recursive: true })
    writeFileSync(modelDir, 'not a directory')
    writeExecutable(binDir, 'whisper-cli', nodeScript("throw new Error('should not run')\n"))

    const provider = createLocalSttProvider({
      env: { HOME: homeDir, PATH: binDir },
      logger,
      tempRoot,
    })

    await expect(provider.detect()).resolves.toBeNull()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('failed to scan whisper.cpp model directory'),
      expect.any(Error)
    )
  })

  test('falls back gracefully when whisper.cpp is available but ffmpeg is missing', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const modelPath = join(tempRoot, 'ggml-base.bin')
    const audioPath = join(tempRoot, 'voice.m4a')
    writeFileSync(modelPath, 'model')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'whisper-cli',
      nodeScript("throw new Error('whisper-cli should not run without ffmpeg')\n")
    )

    const provider = createLocalSttProvider({
      env: { PATH: binDir, WHISPER_CPP_MODEL: modelPath },
      tempRoot,
    })

    await expect(provider.transcribeAudioFile(audioPath)).resolves.toBeNull()
  })

  test('falls back to whisper when whisper-cli is present without a configured model', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const homeDir = setupDir('hive-stt-home-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const audioPath = join(tempRoot, 'voice.ogg')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(binDir, 'ffmpeg', nodeScript('process.exit(9)\n'))
    writeExecutable(binDir, 'whisper-cli', nodeScript("throw new Error('should not run')\n"))
    writeExecutable(
      binDir,
      'whisper',
      nodeScript(`
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, parse } from 'node:path'
const args = process.argv.slice(2)
const outputDir = args[args.indexOf('--output_dir') + 1]
const mediaPath = args.at(-1)
const prompt = args[args.indexOf('--initial_prompt') + 1]
const language = args[args.indexOf('--language') + 1]
if (!prompt?.includes('典韦') || !prompt?.includes('周瑜')) process.exit(4)
if (language !== 'zh') process.exit(5)
mkdirSync(outputDir, { recursive: true })
writeFileSync(join(outputDir, parse(mediaPath).name + '.txt'), 'fallback transcript')
`)
    )

    const provider = createLocalSttProvider({
      env: { HOME: homeDir, PATH: binDir },
      tempRoot,
    })

    const detected = await provider.detect()
    const result = await provider.transcribeAudioFile(audioPath)

    expect(detected?.provider).toBe('whisper')
    expect(result?.text).toBe('fallback transcript')
  })

  test('falls back to stdout when whisper does not create an output txt file', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const audioPath = join(tempRoot, 'voice.ogg')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(binDir, 'whisper', nodeScript("console.log('stdout transcript')\n"))

    const provider = createLocalSttProvider({
      env: { PATH: binDir },
      tempRoot,
    })

    const result = await provider.transcribeAudioFile(audioPath)

    expect(result?.text).toBe('stdout transcript')
    expect(existsSync(join(tempRoot, 'hive-local-stt-leftover'))).toBe(false)
  })

  test('treats python whisper initial prompt echo as no speech', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const audioPath = join(tempRoot, 'voice.ogg')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'whisper',
      nodeScript(`
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, parse } from 'node:path'
const args = process.argv.slice(2)
const outputDir = args[args.indexOf('--output_dir') + 1]
const mediaPath = args.at(-1)
mkdirSync(outputDir, { recursive: true })
writeFileSync(join(outputDir, parse(mediaPath).name + '.txt'), '文普通话语音指令')
`)
    )

    const provider = createLocalSttProvider({
      env: { PATH: binDir },
      tempRoot,
    })

    await expect(provider.transcribeAudioFile(audioPath)).resolves.toBeNull()
  })

  test('treats whisper-cli prompt echo as no speech', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const modelPath = join(tempRoot, 'ggml-base.bin')
    const audioPath = join(tempRoot, 'voice.m4a')
    writeFileSync(modelPath, 'model')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'ffmpeg',
      nodeScript(`
import { writeFileSync } from 'node:fs'
writeFileSync(process.argv.at(-1), 'converted wav bytes')
`)
    )
    writeExecutable(
      binDir,
      'whisper-cli',
      nodeScript(`
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const outputBase = args[args.indexOf('-of') + 1]
writeFileSync(outputBase + '.txt', '团队成员关羽马超赵云钟馗吕布典韦张飞周瑜')
`)
    )

    const provider = createLocalSttProvider({
      env: { PATH: binDir, WHISPER_CPP_MODEL: modelPath },
      tempRoot,
    })

    await expect(provider.transcribeAudioFile(audioPath)).resolves.toBeNull()
  })

  test('does not filter normal Chinese commands that mention worker names', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const audioPath = join(tempRoot, 'voice.ogg')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'whisper',
      nodeScript(`
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, parse } from 'node:path'
const args = process.argv.slice(2)
const outputDir = args[args.indexOf('--output_dir') + 1]
const mediaPath = args.at(-1)
mkdirSync(outputDir, { recursive: true })
writeFileSync(join(outputDir, parse(mediaPath).name + '.txt'), '让关羽汇报')
`)
    )

    const provider = createLocalSttProvider({
      env: { PATH: binDir },
      tempRoot,
    })

    await expect(provider.transcribeAudioFile(audioPath)).resolves.toEqual({
      provider: 'whisper',
      text: '让关羽汇报',
    })
  })

  test('treats known silent-audio hallucination phrase as no speech', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const audioPath = join(tempRoot, 'voice.ogg')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'whisper',
      nodeScript(`
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, parse } from 'node:path'
const args = process.argv.slice(2)
const outputDir = args[args.indexOf('--output_dir') + 1]
const mediaPath = args.at(-1)
mkdirSync(outputDir, { recursive: true })
writeFileSync(join(outputDir, parse(mediaPath).name + '.txt'), '网络中文普通话语音指令')
`)
    )

    const provider = createLocalSttProvider({
      env: { PATH: binDir },
      tempRoot,
    })

    await expect(provider.transcribeAudioFile(audioPath)).resolves.toBeNull()
  })

  test('treats punctuation-only whisper output as no speech', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const audioPath = join(tempRoot, 'voice.ogg')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'whisper',
      nodeScript(`
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, parse } from 'node:path'
const args = process.argv.slice(2)
const outputDir = args[args.indexOf('--output_dir') + 1]
const mediaPath = args.at(-1)
mkdirSync(outputDir, { recursive: true })
writeFileSync(join(outputDir, parse(mediaPath).name + '.txt'), '。，！？')
`)
    )

    const provider = createLocalSttProvider({
      env: { PATH: binDir },
      tempRoot,
    })

    await expect(provider.transcribeAudioFile(audioPath)).resolves.toBeNull()
  })

  test('keeps ordinary voice commands with team names', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const audioPath = join(tempRoot, 'voice.ogg')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'whisper',
      nodeScript(`
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, parse } from 'node:path'
const args = process.argv.slice(2)
const outputDir = args[args.indexOf('--output_dir') + 1]
const mediaPath = args.at(-1)
mkdirSync(outputDir, { recursive: true })
writeFileSync(join(outputDir, parse(mediaPath).name + '.txt'), '让关羽汇报进度')
`)
    )

    const provider = createLocalSttProvider({
      env: { PATH: binDir },
      tempRoot,
    })

    await expect(provider.transcribeAudioFile(audioPath)).resolves.toEqual({
      provider: 'whisper',
      text: '让关羽汇报进度',
    })
  })

  test('treats non-contiguous team name prompt echo as no speech', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const audioPath = join(tempRoot, 'voice.ogg')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'whisper',
      nodeScript(`
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, parse } from 'node:path'
const args = process.argv.slice(2)
const outputDir = args[args.indexOf('--output_dir') + 1]
const mediaPath = args.at(-1)
mkdirSync(outputDir, { recursive: true })
writeFileSync(join(outputDir, parse(mediaPath).name + '.txt'), '马超、赵云、钟馗、张飞、周瑜')
`)
    )

    const provider = createLocalSttProvider({
      env: { PATH: binDir },
      tempRoot,
    })

    await expect(provider.transcribeAudioFile(audioPath)).resolves.toBeNull()
  })

  test('treats noisy repeated team-name prompt echo as no speech', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const audioPath = join(tempRoot, 'voice.ogg')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'whisper',
      nodeScript(`
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, parse } from 'node:path'
const args = process.argv.slice(2)
const outputDir = args[args.indexOf('--output_dir') + 1]
const mediaPath = args.at(-1)
mkdirSync(outputDir, { recursive: true })
writeFileSync(join(outputDir, parse(mediaPath).name + '.txt'), '词:张飞、吕布、赵云、钟馗、赵云、钟馗')
`)
    )

    const provider = createLocalSttProvider({
      env: { PATH: binDir },
      tempRoot,
    })

    await expect(provider.transcribeAudioFile(audioPath)).resolves.toBeNull()
  })

  test('treats subtitle-prefixed team-name prompt echo as no speech', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const audioPath = join(tempRoot, 'voice.ogg')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'whisper',
      nodeScript(`
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, parse } from 'node:path'
const args = process.argv.slice(2)
const outputDir = args[args.indexOf('--output_dir') + 1]
const mediaPath = args.at(-1)
mkdirSync(outputDir, { recursive: true })
writeFileSync(join(outputDir, parse(mediaPath).name + '.txt'), '字幕：关羽、马超、赵云、周瑜')
`)
    )

    const provider = createLocalSttProvider({
      env: { PATH: binDir },
      tempRoot,
    })

    await expect(provider.transcribeAudioFile(audioPath)).resolves.toBeNull()
  })

  test('keeps multi-worker commands that include a real action', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const audioPath = join(tempRoot, 'voice.ogg')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'whisper',
      nodeScript(`
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, parse } from 'node:path'
const args = process.argv.slice(2)
const outputDir = args[args.indexOf('--output_dir') + 1]
const mediaPath = args.at(-1)
mkdirSync(outputDir, { recursive: true })
writeFileSync(join(outputDir, parse(mediaPath).name + '.txt'), '叫张飞和钟馗一起看下')
`)
    )

    const provider = createLocalSttProvider({
      env: { PATH: binDir },
      tempRoot,
    })

    await expect(provider.transcribeAudioFile(audioPath)).resolves.toEqual({
      provider: 'whisper',
      text: '叫张飞和钟馗一起看下',
    })
  })

  test('keeps adjacent multi-worker short action commands', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const audioPath = join(tempRoot, 'voice.ogg')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'whisper',
      nodeScript(`
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, parse } from 'node:path'
const args = process.argv.slice(2)
const outputDir = args[args.indexOf('--output_dir') + 1]
const mediaPath = args.at(-1)
const transcript = process.env.HIVE_TEST_TRANSCRIPT
mkdirSync(outputDir, { recursive: true })
writeFileSync(join(outputDir, parse(mediaPath).name + '.txt'), transcript)
`)
    )

    const keepTranscript = async (text: string) => {
      vi.stubEnv('HIVE_TEST_TRANSCRIPT', text)
      const provider = createLocalSttProvider({
        env: { HIVE_TEST_TRANSCRIPT: text, PATH: binDir },
        tempRoot,
      })

      try {
        await expect(provider.transcribeAudioFile(audioPath)).resolves.toEqual({
          provider: 'whisper',
          text,
        })
      } finally {
        vi.unstubAllEnvs()
      }
    }

    await keepTranscript('关羽张飞钟馗看下')
    await keepTranscript('关羽张飞钟馗重启')
  })

  test('treats full team name prompt echo as no speech', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const audioPath = join(tempRoot, 'voice.ogg')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'whisper',
      nodeScript(`
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, parse } from 'node:path'
const args = process.argv.slice(2)
const outputDir = args[args.indexOf('--output_dir') + 1]
const mediaPath = args.at(-1)
mkdirSync(outputDir, { recursive: true })
writeFileSync(join(outputDir, parse(mediaPath).name + '.txt'), '关羽 马超 赵云 钟馗 吕布 典韦 张飞 周瑜')
`)
    )

    const provider = createLocalSttProvider({
      env: { PATH: binDir },
      tempRoot,
    })

    await expect(provider.transcribeAudioFile(audioPath)).resolves.toBeNull()
  })

  test('does not filter ordinary Chinese question without prompt tokens', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const audioPath = join(tempRoot, 'voice.ogg')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'whisper',
      nodeScript(`
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, parse } from 'node:path'
const args = process.argv.slice(2)
const outputDir = args[args.indexOf('--output_dir') + 1]
const mediaPath = args.at(-1)
mkdirSync(outputDir, { recursive: true })
writeFileSync(join(outputDir, parse(mediaPath).name + '.txt'), '现在几点了')
`)
    )

    const provider = createLocalSttProvider({
      env: { PATH: binDir },
      tempRoot,
    })

    await expect(provider.transcribeAudioFile(audioPath)).resolves.toEqual({
      provider: 'whisper',
      text: '现在几点了',
    })
  })
})
