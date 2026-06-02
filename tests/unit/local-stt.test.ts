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

import { createLocalSttProvider } from '../../src/server/local-stt.js'

const tempDirs: string[] = []

afterEach(() => {
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
})
