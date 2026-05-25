import { execFile } from 'node:child_process'
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, delimiter, join, parse, resolve } from 'node:path'
import { promisify } from 'node:util'

import type { HiveLogger } from './logger.js'

const execFileP = promisify(execFile)

export type LocalSttProviderName = 'whisper-cli' | 'whisper'

export interface LocalSttCli {
  command: string
  model?: string
  provider: LocalSttProviderName
}

export interface LocalSttResult {
  provider: LocalSttProviderName
  text: string
}

export interface LocalSttProvider {
  detect(): Promise<LocalSttCli | null>
  transcribeAudioFile(audioPath: string): Promise<LocalSttResult | null>
}

interface LocalSttProviderOptions {
  env?: NodeJS.ProcessEnv
  logger?: Pick<HiveLogger, 'warn'>
  tempRoot?: string
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_WHISPER_MODEL = 'base'

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

const resolveWhisperCppModel = (env: NodeJS.ProcessEnv): string | null => {
  const model = env.HIVE_STT_WHISPER_CPP_MODEL ?? env.WHISPER_CPP_MODEL
  if (!model) return null
  const absolute = resolve(model)
  return existsSync(absolute) ? absolute : null
}

const readFirstTranscript = (paths: string[], stdout: string) => {
  for (const filePath of paths) {
    if (!existsSync(filePath)) continue
    const text = readFileSync(filePath, 'utf8').trim()
    if (text) return text
  }
  const text = stdout.trim()
  return text ? text : null
}

export const createLocalSttProvider = (options: LocalSttProviderOptions = {}): LocalSttProvider => {
  const env = options.env ?? process.env
  const tempRoot = options.tempRoot ?? tmpdir()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const detectCandidates = (): LocalSttCli[] => {
    const candidates: LocalSttCli[] = []
    const whisperCli = findExecutable('whisper-cli', env)
    const whisperCppModel = resolveWhisperCppModel(env)
    if (whisperCli && whisperCppModel) {
      candidates.push({ command: whisperCli, model: whisperCppModel, provider: 'whisper-cli' })
    }

    const whisper = findExecutable('whisper', env)
    if (whisper) {
      candidates.push({
        command: whisper,
        model: env.HIVE_STT_WHISPER_MODEL ?? env.WHISPER_MODEL ?? DEFAULT_WHISPER_MODEL,
        provider: 'whisper',
      })
    }

    return candidates
  }

  const runWhisperCli = async (cli: LocalSttCli, audioPath: string): Promise<string | null> => {
    if (!cli.model) return null
    const outputDir = mkdtempSync(join(tempRoot, 'hive-local-stt-'))
    try {
      const outputBase = join(outputDir, parse(audioPath).name)
      const { stdout } = await execFileP(
        cli.command,
        ['-m', cli.model, '-otxt', '-of', outputBase, '-np', '-nt', audioPath],
        { maxBuffer: 5 * 1024 * 1024, timeout: timeoutMs }
      )
      return readFirstTranscript([`${outputBase}.txt`], stdout)
    } finally {
      rmSync(outputDir, { force: true, recursive: true })
    }
  }

  const runWhisper = async (cli: LocalSttCli, audioPath: string): Promise<string | null> => {
    const outputDir = mkdtempSync(join(tempRoot, 'hive-local-stt-'))
    try {
      mkdirSync(outputDir, { recursive: true })
      const { stdout } = await execFileP(
        cli.command,
        [
          '--model',
          cli.model ?? DEFAULT_WHISPER_MODEL,
          '--output_format',
          'txt',
          '--output_dir',
          outputDir,
          '--verbose',
          'False',
          audioPath,
        ],
        { maxBuffer: 5 * 1024 * 1024, timeout: timeoutMs }
      )
      return readFirstTranscript(
        [
          join(outputDir, `${parse(audioPath).name}.txt`),
          join(outputDir, `${basename(audioPath)}.txt`),
        ],
        stdout
      )
    } finally {
      rmSync(outputDir, { force: true, recursive: true })
    }
  }

  return {
    async detect() {
      return detectCandidates()[0] ?? null
    },
    async transcribeAudioFile(audioPath: string) {
      for (const cli of detectCandidates()) {
        try {
          const text =
            cli.provider === 'whisper-cli'
              ? await runWhisperCli(cli, audioPath)
              : await runWhisper(cli, audioPath)
          if (text) return { provider: cli.provider, text }
        } catch (error) {
          options.logger?.warn(
            `local STT failed provider=${cli.provider} command=${cli.command} audio=${audioPath}`,
            error
          )
        }
      }
      return null
    },
  }
}
