import { execFile } from 'node:child_process'
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
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
const DEFAULT_STT_PROMPT =
  '以下是简体中文普通话语音指令。团队成员：关羽、马超、赵云、钟馗、吕布、典韦、张飞、周瑜。'

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

const findExecutableAny = (names: string[], env: NodeJS.ProcessEnv): string | null => {
  for (const name of names) {
    const executable = findExecutable(name, env)
    if (executable) return executable
  }
  return null
}

const getHomeDir = (env: NodeJS.ProcessEnv) => env.HOME ?? homedir()

const resolveWhisperCppModel = (
  env: NodeJS.ProcessEnv,
  logger?: Pick<HiveLogger, 'warn'>
): string | null => {
  const model = env.HIVE_STT_WHISPER_CPP_MODEL ?? env.WHISPER_CPP_MODEL
  if (model) {
    const absolute = resolve(model)
    return existsSync(absolute) ? absolute : null
  }
  const modelDir = join(getHomeDir(env), '.config', 'hive', 'whisper-models')
  if (!existsSync(modelDir)) return null
  let modelFiles: string[]
  try {
    modelFiles = readdirSync(modelDir)
      .filter((name) => name.endsWith('.bin'))
      .sort((a, b) => a.localeCompare(b))
  } catch (error) {
    logger?.warn(`failed to scan whisper.cpp model directory: ${modelDir}`, error)
    return null
  }
  const firstModel = modelFiles[0]
  return firstModel ? join(modelDir, firstModel) : null
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
    const whisperCli = findExecutableAny(['whisper-cli', 'whisper-cpp', 'main'], env)
    const whisperCppModel = resolveWhisperCppModel(env, options.logger)
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
    const ffmpeg = findExecutable('ffmpeg', env)
    if (!ffmpeg) {
      throw new Error('ffmpeg is required to convert audio for whisper.cpp')
    }
    const outputDir = mkdtempSync(join(tempRoot, 'hive-local-stt-'))
    try {
      const wavPath = join(outputDir, `${parse(audioPath).name}.wav`)
      await execFileP(
        ffmpeg,
        ['-i', audioPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', '-y', wavPath],
        { maxBuffer: 5 * 1024 * 1024, timeout: timeoutMs }
      )
      const outputBase = join(outputDir, parse(wavPath).name)
      const { stdout } = await execFileP(
        cli.command,
        [
          '-m',
          cli.model,
          '--prompt',
          DEFAULT_STT_PROMPT,
          '-otxt',
          '-of',
          outputBase,
          '-np',
          '-nt',
          wavPath,
        ],
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
          '--initial_prompt',
          DEFAULT_STT_PROMPT,
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
