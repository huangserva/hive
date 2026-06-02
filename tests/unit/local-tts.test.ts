import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { createLocalTtsProvider } from '../../src/server/local-tts.js'

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

describe('LocalTtsProvider', () => {
  test('returns null when no supported local TTS CLI is available', async () => {
    const binDir = setupDir('hive-tts-bin-')
    const tempRoot = setupDir('hive-tts-tmp-')

    const provider = createLocalTtsProvider({
      env: { PATH: binDir },
      tempRoot,
    })

    await expect(provider.detect()).resolves.toBeNull()
    await expect(provider.synthesize('hello')).resolves.toBeNull()
  })

  test('piper is skipped when HIVE_TTS_PIPER_MODEL env is not set', async () => {
    const binDir = setupDir('hive-tts-bin-')
    const tempRoot = setupDir('hive-tts-tmp-')
    writeExecutable(
      binDir,
      'piper',
      nodeScript("throw new Error('piper should not run without model')\n")
    )

    const provider = createLocalTtsProvider({
      env: { PATH: binDir },
      tempRoot,
    })

    await expect(provider.detect()).resolves.toBeNull()
  })

  test('piper detect requires HIVE_TTS_PIPER_MODEL env', async () => {
    const binDir = setupDir('hive-tts-bin-')
    const tempRoot = setupDir('hive-tts-tmp-')
    writeExecutable(
      binDir,
      'piper',
      nodeScript("throw new Error('piper should not run without model')\n")
    )

    const provider = createLocalTtsProvider({
      env: { PATH: binDir, HIVE_TTS_PIPER_MODEL: '/fake/model.onnx' },
      tempRoot,
    })

    const detected = await provider.detect()
    expect(detected?.provider).toBe('piper')
    expect(detected?.model).toBe('/fake/model.onnx')
  })

  test('piper reads text via --input_file and receives --model flag', async () => {
    const binDir = setupDir('hive-tts-bin-')
    const tempRoot = setupDir('hive-tts-tmp-')
    const modelFile = join(setupDir('hive-tts-model-'), 'model.onnx')
    writeFileSync(modelFile, 'fake-model', 'utf8')

    writeExecutable(
      binDir,
      'piper',
      nodeScript(`
import { writeFileSync, readFileSync } from 'node:fs'
const args = process.argv.slice(2)
const modelIdx = args.indexOf('--model')
if (modelIdx < 0) { process.stderr.write('missing --model'); process.exit(1) }
const model = args[modelIdx + 1]
const inputIdx = args.indexOf('--input_file')
if (inputIdx < 0) { process.stderr.write('missing --input_file'); process.exit(1) }
const inputPath = args[inputIdx + 1]
const text = readFileSync(inputPath, 'utf8').trim()
const outIdx = args.indexOf('--output_file')
if (outIdx < 0) { process.stderr.write('missing --output_file'); process.exit(1) }
const outPath = args[outIdx + 1]
writeFileSync(outPath, Buffer.from('piper:' + model + ':' + text))
`)
    )

    const provider = createLocalTtsProvider({
      env: { PATH: binDir, HIVE_TTS_PIPER_MODEL: modelFile },
      tempRoot,
    })

    const result = await provider.synthesize('hello world')
    expect(result).not.toBeNull()
    expect(result?.provider).toBe('piper')
    expect(result?.format).toBe('wav')
    expect(result?.mime).toBe('audio/wav')
    const content = result!.audio.toString('utf8')
    expect(content).toContain('piper:' + modelFile + ':')
    expect(content).toContain('hello world')
    expect(readdirSync(tempRoot).filter((name) => name.startsWith('hive-local-tts-'))).toEqual([])
  })

  test('say outputs AIFF format and uses Tingting voice by default', async () => {
    const binDir = setupDir('hive-tts-bin-')
    const tempRoot = setupDir('hive-tts-tmp-')
    writeExecutable(
      binDir,
      'say',
      nodeScript(`
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const outFile = args[args.indexOf('-o') + 1]
const voiceIdx = args.indexOf('-v')
const voice = voiceIdx >= 0 ? args[voiceIdx + 1] : 'default'
const textArg = args[args.length - 1]
writeFileSync(outFile, Buffer.from('aiff:' + voice + ':' + textArg))
`)
    )

    const provider = createLocalTtsProvider({
      env: { PATH: binDir },
      tempRoot,
    })

    const result = await provider.synthesize('test')
    expect(result).not.toBeNull()
    expect(result?.provider).toBe('say')
    expect(result?.format).toBe('aiff')
    expect(result?.mime).toBe('audio/aiff')
    const content = result!.audio.toString('utf8')
    expect(content).toContain('aiff:Tingting:test')
  })

  test('say uses HIVE_TTS_SAY_VOICE env when set', async () => {
    const binDir = setupDir('hive-tts-bin-')
    const tempRoot = setupDir('hive-tts-tmp-')
    writeExecutable(
      binDir,
      'say',
      nodeScript(`
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const outFile = args[args.indexOf('-o') + 1]
const voiceIdx = args.indexOf('-v')
const voice = voiceIdx >= 0 ? args[voiceIdx + 1] : 'default'
writeFileSync(outFile, Buffer.from('voice=' + voice))
`)
    )

    const provider = createLocalTtsProvider({
      env: { PATH: binDir, HIVE_TTS_SAY_VOICE: 'Kyoko' },
      tempRoot,
    })

    const result = await provider.synthesize('konnichiwa')
    expect(result).not.toBeNull()
    expect(result?.audio.toString('utf8')).toBe('voice=Kyoko')
  })

  test('prefers piper over say when both are available with model', async () => {
    const binDir = setupDir('hive-tts-bin-')
    const tempRoot = setupDir('hive-tts-tmp-')
    const modelFile = join(setupDir('hive-tts-model-'), 'model.onnx')
    writeFileSync(modelFile, 'fake-model', 'utf8')

    writeExecutable(
      binDir,
      'piper',
      nodeScript(`
import { writeFileSync, readFileSync } from 'node:fs'
const args = process.argv.slice(2)
const inputIdx = args.indexOf('--input_file')
const inputPath = args[inputIdx + 1]
const text = readFileSync(inputPath, 'utf8').trim()
const outIdx = args.indexOf('--output_file')
const outPath = args[outIdx + 1]
writeFileSync(outPath, Buffer.from('piper:' + text))
`)
    )
    writeExecutable(binDir, 'say', nodeScript("throw new Error('say should not run')\n"))

    const provider = createLocalTtsProvider({
      env: { PATH: binDir, HIVE_TTS_PIPER_MODEL: modelFile },
      tempRoot,
    })

    const result = await provider.synthesize('prefer piper')
    expect(result?.provider).toBe('piper')
    expect(result?.audio.toString('utf8')).toBe('piper:prefer piper')
  })

  test('returns null when TTS CLI exits with non-zero', async () => {
    const binDir = setupDir('hive-tts-bin-')
    const tempRoot = setupDir('hive-tts-tmp-')
    writeExecutable(binDir, 'say', nodeScript('process.exit(1)\n'))

    const provider = createLocalTtsProvider({
      env: { PATH: binDir },
      tempRoot,
    })

    const result = await provider.synthesize('fail test')
    expect(result).toBeNull()
  })

  test('returns null for empty text', async () => {
    const binDir = setupDir('hive-tts-bin-')
    const tempRoot = setupDir('hive-tts-tmp-')
    writeExecutable(
      binDir,
      'say',
      nodeScript(`
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const outFile = args[args.indexOf('-o') + 1]
writeFileSync(outFile, Buffer.from('aiff'))
`)
    )

    const provider = createLocalTtsProvider({
      env: { PATH: binDir },
      tempRoot,
    })

    const validResult = await provider.synthesize('valid')
    expect(validResult).not.toBeNull()

    const emptyResult = await provider.synthesize('   ')
    expect(emptyResult).toBeNull()
  })

  test('returns null for text exceeding 2000 characters', async () => {
    const binDir = setupDir('hive-tts-bin-')
    const tempRoot = setupDir('hive-tts-tmp-')
    writeExecutable(
      binDir,
      'say',
      nodeScript(`
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const outFile = args[args.indexOf('-o') + 1]
writeFileSync(outFile, Buffer.from('aiff'))
`)
    )

    const provider = createLocalTtsProvider({
      env: { PATH: binDir },
      tempRoot,
    })

    const validResult = await provider.synthesize('short text')
    expect(validResult).not.toBeNull()

    const longResult = await provider.synthesize('x'.repeat(2001))
    expect(longResult).toBeNull()
  })
})
