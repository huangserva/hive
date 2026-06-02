import { execFile } from 'node:child_process'
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import type { HiveLogger } from './logger.js'

const execFileP = promisify(execFile)

export type LocalTtsProviderName = 'piper' | 'say'

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

export interface LocalTtsProvider {
  detect(): Promise<LocalTtsCli | null>
  synthesize(text: string): Promise<LocalTtsResult | null>
}

interface LocalTtsProviderOptions {
  env?: NodeJS.ProcessEnv
  logger?: Pick<HiveLogger, 'warn'>
  tempRoot?: string
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_SAY_VOICE = 'Tingting'
const MAX_TEXT_LENGTH = 2000

const isExecutable = (filePath: string) => {
  try {
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

const findExecutable = (name: string, env: NodeJS.ProcessEnv): string | null => {
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

export const createLocalTtsProvider = (options: LocalTtsProviderOptions = {}): LocalTtsProvider => {
  const env = options.env ?? process.env
  const tempRoot = options.tempRoot ?? tmpdir()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const detectCandidates = (): LocalTtsCli[] => {
    const candidates: LocalTtsCli[] = []

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

  const runPiper = async (cli: LocalTtsCli, text: string): Promise<Buffer | null> => {
    const outputDir = mkdtempSync(join(tempRoot, 'hive-local-tts-'))
    try {
      const outputPath = join(outputDir, 'tts.wav')
      const inputPath = join(outputDir, 'input.txt')
      writeFileSync(inputPath, text, 'utf8')
      const args = ['--model', cli.model!, '--input_file', inputPath, '--output_file', outputPath, '--quiet']
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

  const runSay = async (cli: LocalTtsCli, text: string): Promise<Buffer | null> => {
    const outputDir = mkdtempSync(join(tempRoot, 'hive-local-tts-'))
    try {
      const outputPath = join(outputDir, 'tts.aiff')
      const args = ['-o', outputPath]
      if (cli.voice) args.push('-v', cli.voice)
      args.push(text)
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

  return {
    async detect() {
      return detectCandidates()[0] ?? null
    },
    async synthesize(text: string) {
      if (!text.trim() || text.length > MAX_TEXT_LENGTH) return null
      for (const cli of detectCandidates()) {
        try {
          const audio =
            cli.provider === 'piper' ? await runPiper(cli, text) : await runSay(cli, text)
          if (audio) {
            const format = cli.provider === 'piper' ? 'wav' : 'aiff'
            const mime = cli.provider === 'piper' ? 'audio/wav' : 'audio/aiff'
            return { audio, format, mime, provider: cli.provider }
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
