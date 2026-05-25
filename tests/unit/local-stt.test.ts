import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

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
    const tempRoot = setupDir('hive-stt-tmp-')
    const audioPath = join(tempRoot, 'voice.ogg')
    writeFileSync(audioPath, 'audio bytes')

    const provider = createLocalSttProvider({
      env: { PATH: binDir },
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
const mediaPath = args.at(-1)
if (!mediaPath || basename(mediaPath) !== 'voice.ogg') process.exit(3)
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
    const audioPath = join(tempRoot, 'voice.wav')
    writeFileSync(modelPath, 'model')
    writeFileSync(audioPath, 'audio bytes')
    writeExecutable(
      binDir,
      'whisper-cli',
      nodeScript(`
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const model = args[args.indexOf('-m') + 1]
const outputBase = args[args.indexOf('-of') + 1]
if (!model.endsWith('ggml-small.bin')) process.exit(4)
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

  test('falls back to whisper when whisper-cli is present without a configured model', async () => {
    const binDir = setupDir('hive-stt-bin-')
    const tempRoot = setupDir('hive-stt-tmp-')
    const audioPath = join(tempRoot, 'voice.ogg')
    writeFileSync(audioPath, 'audio bytes')
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
mkdirSync(outputDir, { recursive: true })
writeFileSync(join(outputDir, parse(mediaPath).name + '.txt'), 'fallback transcript')
`)
    )

    const provider = createLocalSttProvider({
      env: { PATH: binDir },
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
