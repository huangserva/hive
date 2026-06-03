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
    if (!result) throw new Error('expected piper result')
    const content = result.audio.toString('utf8')
    expect(content).toContain(`piper:${modelFile}:`)
    expect(content).toContain('hello world')
    expect(readdirSync(tempRoot).filter((name) => name.startsWith('hive-local-tts-'))).toEqual([])
  })

  test('say converts AIFF output to m4a and uses Tingting voice by default', async () => {
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
    writeExecutable(
      binDir,
      'ffmpeg',
      nodeScript(`
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
const args = process.argv.slice(2)
const input = args[args.indexOf('-i') + 1]
const output = args.at(-1)
if (basename(input) !== 'tts.aiff') process.exit(2)
if (args[args.indexOf('-c:a') + 1] !== 'aac') process.exit(3)
if (args[args.indexOf('-b:a') + 1] !== '64k') process.exit(4)
if (!output || basename(output) !== 'tts.m4a') process.exit(5)
writeFileSync(output, Buffer.concat([Buffer.from('m4a:'), readFileSync(input)]))
`)
    )

    const provider = createLocalTtsProvider({
      env: { PATH: binDir },
      tempRoot,
    })

    const result = await provider.synthesize('test')
    expect(result).not.toBeNull()
    expect(result?.provider).toBe('say')
    expect(result?.format).toBe('m4a')
    expect(result?.mime).toBe('audio/mp4')
    if (!result) throw new Error('expected say result')
    const content = result.audio.toString('utf8')
    expect(content).toContain('m4a:aiff:Tingting:test')
  })

  test('say falls back to wav when ffmpeg is unavailable', async () => {
    const binDir = setupDir('hive-tts-bin-')
    const tempRoot = setupDir('hive-tts-tmp-')
    writeExecutable(
      binDir,
      'say',
      nodeScript(`
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const outFile = args[args.indexOf('-o') + 1]
if (!args.includes('--file-format=WAVE')) process.exit(2)
if (!args.includes('--data-format=LEI16@22050')) process.exit(3)
writeFileSync(outFile, Buffer.from('wav-fallback'))
`)
    )

    const provider = createLocalTtsProvider({
      env: { PATH: binDir },
      tempRoot,
    })

    const result = await provider.synthesize('fallback')
    expect(result?.provider).toBe('say')
    expect(result?.format).toBe('wav')
    expect(result?.mime).toBe('audio/wav')
    expect(result?.audio.toString('utf8')).toBe('wav-fallback')
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
    writeExecutable(
      binDir,
      'ffmpeg',
      nodeScript(`
import { readFileSync, writeFileSync } from 'node:fs'
const input = process.argv[process.argv.indexOf('-i') + 1]
writeFileSync(process.argv.at(-1), readFileSync(input))
`)
    )

    const provider = createLocalTtsProvider({
      env: { PATH: binDir, HIVE_TTS_SAY_VOICE: 'Kyoko' },
      tempRoot,
    })

    const result = await provider.synthesize('konnichiwa')
    expect(result).not.toBeNull()
    expect(result?.audio.toString('utf8')).toBe('voice=Kyoko')
    expect(result?.format).toBe('m4a')
  })

  test('edge-tts is preferred over piper and say and returns mp3 audio with Xiaoxiao by default', async () => {
    const binDir = setupDir('hive-tts-bin-')
    const tempRoot = setupDir('hive-tts-tmp-')
    const modelFile = join(setupDir('hive-tts-model-'), 'model.onnx')
    writeFileSync(modelFile, 'fake-model', 'utf8')

    writeExecutable(
      binDir,
      'edge-tts',
      nodeScript(`
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const voice = args[args.indexOf('--voice') + 1]
const text = args[args.indexOf('--text') + 1]
const outPath = args[args.indexOf('--write-media') + 1]
if (voice !== 'zh-CN-XiaoxiaoNeural') process.exit(2)
writeFileSync(outPath, Buffer.from('edge:' + voice + ':' + text))
`)
    )
    writeExecutable(binDir, 'piper', nodeScript("throw new Error('piper should not run')\n"))
    writeExecutable(binDir, 'say', nodeScript("throw new Error('say should not run')\n"))

    const provider = createLocalTtsProvider({
      env: { PATH: binDir, HIVE_TTS_PIPER_MODEL: modelFile },
      tempRoot,
    })

    const detected = await provider.detect()
    expect(detected?.provider).toBe('edge-tts')
    expect(detected?.voice).toBe('zh-CN-XiaoxiaoNeural')
    const result = await provider.synthesize('你好')
    expect(result?.provider).toBe('edge-tts')
    expect(result?.format).toBe('mp3')
    expect(result?.mime).toBe('audio/mpeg')
    expect(result?.audio.toString('utf8')).toBe('edge:zh-CN-XiaoxiaoNeural:你好')
  })

  test('edge-tts uses HIVE_TTS_EDGE_VOICE env when set', async () => {
    const binDir = setupDir('hive-tts-bin-')
    const tempRoot = setupDir('hive-tts-tmp-')
    writeExecutable(
      binDir,
      'edge-tts',
      nodeScript(`
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const outPath = args[args.indexOf('--write-media') + 1]
writeFileSync(outPath, Buffer.from('voice=' + args[args.indexOf('--voice') + 1]))
`)
    )

    const provider = createLocalTtsProvider({
      env: { PATH: binDir, HIVE_TTS_EDGE_VOICE: 'zh-CN-YunxiNeural' },
      tempRoot,
    })

    const result = await provider.synthesize('你好')
    expect(result?.provider).toBe('edge-tts')
    expect(result?.audio.toString('utf8')).toBe('voice=zh-CN-YunxiNeural')
  })

  test('edge-tts request voice overrides the configured default for one synthesis', async () => {
    const binDir = setupDir('hive-tts-bin-')
    const tempRoot = setupDir('hive-tts-tmp-')
    writeExecutable(
      binDir,
      'edge-tts',
      nodeScript(`
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const outPath = args[args.indexOf('--write-media') + 1]
writeFileSync(outPath, Buffer.from('voice=' + args[args.indexOf('--voice') + 1]))
`)
    )

    const provider = createLocalTtsProvider({
      env: { PATH: binDir, HIVE_TTS_EDGE_VOICE: 'zh-CN-XiaoxiaoNeural' },
      tempRoot,
    })

    const result = await provider.synthesize('你好', { voice: 'zh-CN-YunxiNeural' })
    expect(result?.provider).toBe('edge-tts')
    expect(result?.audio.toString('utf8')).toBe('voice=zh-CN-YunxiNeural')
  })

  test('edge-tts failure falls back to say instead of failing the whole synthesis', async () => {
    const binDir = setupDir('hive-tts-bin-')
    const tempRoot = setupDir('hive-tts-tmp-')
    writeExecutable(binDir, 'edge-tts', nodeScript('process.exit(1)\n'))
    writeExecutable(
      binDir,
      'say',
      nodeScript(`
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const outFile = args[args.indexOf('-o') + 1]
writeFileSync(outFile, Buffer.from('say-fallback'))
`)
    )
    writeExecutable(
      binDir,
      'ffmpeg',
      nodeScript(`
import { readFileSync, writeFileSync } from 'node:fs'
const input = process.argv[process.argv.indexOf('-i') + 1]
writeFileSync(process.argv.at(-1), readFileSync(input))
`)
    )

    const provider = createLocalTtsProvider({
      env: { PATH: binDir },
      tempRoot,
      timeoutMs: 1000,
    })

    const result = await provider.synthesize('fallback')
    expect(result?.provider).toBe('say')
    expect(result?.format).toBe('m4a')
    expect(result?.mime).toBe('audio/mp4')
    expect(result?.audio.toString('utf8')).toBe('say-fallback')
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
