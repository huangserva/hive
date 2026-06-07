import { execFile } from 'node:child_process'
import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import type { HiveLogger } from './logger.js'

const execFileP = promisify(execFile)

export type LocalTtsProviderName = 'edge-tts' | 'piper' | 'say'

export interface LocalTtsCli {
  command: string
  model?: string
  provider: LocalTtsProviderName
  voice?: string
}

export interface LocalTtsResult {
  audio: Buffer
  format: string
  mime: string
  provider: LocalTtsProviderName
}

export interface LocalTtsSynthesisOptions {
  voice?: string
}

interface LocalTtsAudio {
  audio: Buffer
  format: string
  mime: string
}

export interface LocalTtsProvider {
  detect(): Promise<LocalTtsCli | null>
  synthesize(text: string, options?: LocalTtsSynthesisOptions): Promise<LocalTtsResult | null>
}

interface LocalTtsProviderOptions {
  env?: Record<string, string | undefined>
  logger?: Pick<HiveLogger, 'warn'>
  tempRoot?: string
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_EDGE_TIMEOUT_MS = 8_000
const DEFAULT_EDGE_VOICE = 'zh-CN-XiaoxiaoNeural'
const DEFAULT_EDGE_VOLUME = '+40%'
const DEFAULT_SAY_VOICE = 'Tingting'
const MAX_TEXT_LENGTH = 2000
const EDGE_VOLUME_PATTERN = /^[+-]\d+%$/

const isExecutable = (filePath: string) => {
  try {
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

const findExecutable = (name: string, env: Record<string, string | undefined>): string | null => {
  if (name.includes('/')) {
    const absolute = resolve(name)
    return existsSync(absolute) && isExecutable(absolute) ? absolute : null
  }

  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, name)
    if (existsSync(candidate) && isExecutable(candidate)) return candidate
  }

  return null
}

const resolveEdgeVolume = (env: Record<string, string | undefined>): string | null => {
  const configured = env.HIVE_TTS_EDGE_VOLUME
  const volume = configured === undefined ? DEFAULT_EDGE_VOLUME : configured.trim()
  return EDGE_VOLUME_PATTERN.test(volume) ? volume : null
}

export const createLocalTtsProvider = (options: LocalTtsProviderOptions = {}): LocalTtsProvider => {
  const env = options.env ?? process.env
  const tempRoot = options.tempRoot ?? tmpdir()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const detectCandidates = (): LocalTtsCli[] => {
    const candidates: LocalTtsCli[] = []

    const edgeTts = findExecutable('edge-tts', env)
    if (edgeTts) {
      const voice = env.HIVE_TTS_EDGE_VOICE ?? DEFAULT_EDGE_VOICE
      candidates.push({ command: edgeTts, provider: 'edge-tts', voice })
    }

    const piper = findExecutable('piper', env)
    const piperModel = env.HIVE_TTS_PIPER_MODEL
    if (piper && piperModel) {
      candidates.push({ command: piper, model: piperModel, provider: 'piper' })
    }

    const say = findExecutable('say', env)
    if (say) {
      const voice = env.HIVE_TTS_SAY_VOICE ?? DEFAULT_SAY_VOICE
      candidates.push({ command: say, provider: 'say', voice })
    }

    return candidates
  }

  const runEdgeTts = async (
    cli: LocalTtsCli,
    text: string,
    voice?: string
  ): Promise<LocalTtsAudio | null> => {
    const outputDir = mkdtempSync(join(tempRoot, 'hive-local-tts-'))
    try {
      const outputPath = join(outputDir, 'tts.mp3')
      const resolvedVoice = voice?.trim() || cli.voice || DEFAULT_EDGE_VOICE
      const volume = resolveEdgeVolume(env)
      const args = ['--voice', resolvedVoice, '--text', text, '--write-media', outputPath]
      if (volume) args.push('--volume', volume)
      await execFileP(cli.command, args, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: Math.min(timeoutMs, DEFAULT_EDGE_TIMEOUT_MS),
      })
      if (!existsSync(outputPath)) return null
      return { audio: readFileSync(outputPath), format: 'mp3', mime: 'audio/mpeg' }
    } finally {
      rmSync(outputDir, { force: true, recursive: true })
    }
  }

  const runPiper = async (cli: LocalTtsCli, text: string): Promise<Buffer | null> => {
    if (!cli.model) return null
    const outputDir = mkdtempSync(join(tempRoot, 'hive-local-tts-'))
    try {
      const outputPath = join(outputDir, 'tts.wav')
      const inputPath = join(outputDir, 'input.txt')
      writeFileSync(inputPath, text, 'utf8')
      const args = [
        '--model',
        cli.model,
        '--input_file',
        inputPath,
        '--output_file',
        outputPath,
        '--quiet',
      ]
      await execFileP(cli.command, args, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeoutMs,
      })
      if (!existsSync(outputPath)) return null
      return readFileSync(outputPath)
    } finally {
      rmSync(outputDir, { force: true, recursive: true })
    }
  }

  const runSay = async (cli: LocalTtsCli, text: string): Promise<LocalTtsAudio | null> => {
    const outputDir = mkdtempSync(join(tempRoot, 'hive-local-tts-'))
    try {
      const outputAiffPath = join(outputDir, 'tts.aiff')
      const outputM4aPath = join(outputDir, 'tts.m4a')
      const outputWavPath = join(outputDir, 'tts.wav')
      const runWavFallback = async () => {
        const wavArgs = ['-o', outputWavPath, '--file-format=WAVE', '--data-format=LEI16@22050']
        if (cli.voice) wavArgs.push('-v', cli.voice)
        wavArgs.push(text)
        await execFileP(cli.command, wavArgs, {
          maxBuffer: 10 * 1024 * 1024,
          timeout: timeoutMs,
        })
        if (!existsSync(outputWavPath)) return null
        return { audio: readFileSync(outputWavPath), format: 'wav', mime: 'audio/wav' }
      }
      const ffmpeg = findExecutable('ffmpeg', env)
      if (!ffmpeg) return await runWavFallback()

      const args = ['-o', outputAiffPath]
      if (cli.voice) args.push('-v', cli.voice)
      args.push(text)
      await execFileP(cli.command, args, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeoutMs,
      })
      if (!existsSync(outputAiffPath)) return null

      try {
        await execFileP(
          ffmpeg,
          ['-i', outputAiffPath, '-c:a', 'aac', '-b:a', '64k', '-y', outputM4aPath],
          { maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs }
        )
        if (existsSync(outputM4aPath)) {
          return { audio: readFileSync(outputM4aPath), format: 'm4a', mime: 'audio/mp4' }
        }
      } catch (error) {
        options.logger?.warn('local TTS say ffmpeg conversion failed', error)
      }
      return await runWavFallback()
    } finally {
      rmSync(outputDir, { force: true, recursive: true })
    }
  }

  return {
    async detect() {
      return detectCandidates()[0] ?? null
    },
    async synthesize(text: string, synthesisOptions: LocalTtsSynthesisOptions = {}) {
      if (!text.trim() || text.length > MAX_TEXT_LENGTH) return null
      for (const cli of detectCandidates()) {
        try {
          if (cli.provider === 'edge-tts') {
            const result = await runEdgeTts(cli, text, synthesisOptions.voice)
            if (result) return { ...result, provider: cli.provider }
          } else if (cli.provider === 'piper') {
            const audio = await runPiper(cli, text)
            if (audio) return { audio, format: 'wav', mime: 'audio/wav', provider: cli.provider }
          } else {
            const result = await runSay(cli, text)
            if (result) return { ...result, provider: cli.provider }
          }
        } catch (error) {
          options.logger?.warn(
            `local TTS failed provider=${cli.provider} command=${cli.command}`,
            error
          )
        }
      }
      return null
    },
  }
}
