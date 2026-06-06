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

export type LocalSttProviderName = 'paraformer' | 'whisper-cli' | 'whisper'

export interface LocalSttCli {
  command: string
  model?: string
  provider: LocalSttProviderName
  tokens?: string
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
  logger?: Pick<HiveLogger, 'warn'> & Partial<Pick<HiveLogger, 'info'>>
  loadSherpaOnnx?: () => Promise<SherpaOnnxRuntime>
  tempRoot?: string
  timeoutMs?: number
}

interface SherpaWaveData {
  sampleRate: number
  samples: Float32Array
}

interface SherpaOfflineStream {
  acceptWaveFile?: (filePath: string) => void
  acceptWaveform?: (sampleRate: number, samples: Float32Array) => void
  free?: () => void
}

interface SherpaOfflineRecognizer {
  createStream(): SherpaOfflineStream
  decode(stream: SherpaOfflineStream): void
  free?: () => void
  getResult(stream?: SherpaOfflineStream): { text?: string } | string | null
}

interface SherpaOnnxRuntime {
  createOfflineRecognizer?: (config: unknown) => SherpaOfflineRecognizer
  OfflineRecognizer?: new (config: unknown) => SherpaOfflineRecognizer
  readWave?: (filePath: string) => SherpaWaveData | null
}

interface ParaformerRecognizerCache {
  activeStreams: number
  freeWhenIdle: boolean
  freed: boolean
  key: string
  recognizer: SherpaOfflineRecognizer
  runtime: SherpaOnnxRuntime
}

interface ParaformerRecognizerLease {
  recognizer: SherpaOfflineRecognizer
  release: () => void
  runtime: SherpaOnnxRuntime
}

let paraformerRecognizerCache: ParaformerRecognizerCache | null = null
const paraformerRecognizerLoads = new Map<string, Promise<ParaformerRecognizerCache>>()

const releaseParaformerRecognizer = (cache: ParaformerRecognizerCache) => {
  cache.activeStreams = Math.max(0, cache.activeStreams - 1)
  if (cache.freeWhenIdle && cache.activeStreams === 0 && !cache.freed) {
    cache.freed = true
    cache.recognizer.free?.()
  }
}

const retireParaformerRecognizer = (cache: ParaformerRecognizerCache) => {
  cache.freeWhenIdle = true
  if (cache.activeStreams === 0 && !cache.freed) {
    cache.freed = true
    cache.recognizer.free?.()
  }
}

export const __resetParaformerRecognizerCacheForTests = () => {
  const caches = new Set<ParaformerRecognizerCache>()
  if (paraformerRecognizerCache) caches.add(paraformerRecognizerCache)
  for (const promise of paraformerRecognizerLoads.values()) {
    promise.then(
      (cache) => {
        cache.freeWhenIdle = true
        if (cache.activeStreams === 0 && !cache.freed) {
          cache.freed = true
          cache.recognizer.free?.()
        }
      },
      () => {}
    )
  }
  for (const cache of caches) {
    if (!cache.freed) {
      cache.freed = true
      cache.recognizer.free?.()
    }
  }
  paraformerRecognizerCache = null
  paraformerRecognizerLoads.clear()
}

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_PARAFORMER_MODEL_DIR_NAME = 'paraformer-models'
const DEFAULT_WHISPER_MODEL = 'base'
const DEFAULT_STT_LANGUAGE = 'zh'
const DEFAULT_STT_PROMPT =
  '以下是简体中文普通话语音指令。团队成员：关羽、马超、赵云、钟馗、吕布、典韦、张飞、周瑜。'
const MIN_PROMPT_ECHO_CHARS = 8
const TEAM_MEMBER_NAMES = ['关羽', '马超', '赵云', '钟馗', '吕布', '典韦', '张飞', '周瑜'] as const
const PROMPT_ECHO_CONTENT_TOKENS = [
  '以下',
  '简体',
  '中文',
  '普通话',
  '语音',
  '指令',
  '团队',
  '成员',
  ...TEAM_MEMBER_NAMES,
] as const
const PROMPT_ECHO_TOKEN_OVERLAP_RATIO = 0.7
const MIN_PROMPT_ECHO_TOKEN_COUNT = 3
const MIN_TEAM_NAME_ECHO_COUNT = 3
const MAX_PROMPT_ECHO_RESIDUAL_CHARS = 2
const PROMPT_ECHO_NOISE_FRAGMENTS = ['词', '字幕', '以下是', '以下', '是'] as const
const PROMPT_ECHO_ACTION_FRAGMENTS = [
  '看',
  '看下',
  '查',
  '测',
  '审',
  '停',
  '重启',
  '汇报',
  '做',
  '去',
  '来',
  '等',
] as const
const SILENT_AUDIO_HALLUCINATION_PHRASES = [
  '网络中文普通话语音指令',
  '网站中文普通话语音指令',
  '中文普通话语音指令',
] as const
const CONSERVATIVE_GIBBERISH_TEXT_FRAGMENTS = [
  '有没有奶',
  '还个要',
  '我是十那个',
  '推荐你去牛奶',
] as const

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

const getHomeDir = (env: NodeJS.ProcessEnv) => env.HOME ?? (env === process.env ? homedir() : null)

const defaultLoadSherpaOnnx = async (): Promise<SherpaOnnxRuntime> => {
  const moduleName = 'sherpa-onnx'
  return (await import(moduleName)) as SherpaOnnxRuntime
}

const resolveParaformerModel = (
  env: NodeJS.ProcessEnv,
  logger?: Pick<HiveLogger, 'warn'>
): { model: string; tokens: string } | null => {
  const configuredModel = env.HIVE_STT_PARAFORMER_MODEL ?? env.PARAFORMER_MODEL
  const configuredTokens = env.HIVE_STT_PARAFORMER_TOKENS ?? env.PARAFORMER_TOKENS
  if (configuredModel && configuredTokens) {
    const model = resolve(configuredModel)
    const tokens = resolve(configuredTokens)
    return existsSync(model) && existsSync(tokens) ? { model, tokens } : null
  }

  const homeDir = getHomeDir(env)
  const modelDir = env.HIVE_STT_PARAFORMER_MODEL_DIR
    ? resolve(env.HIVE_STT_PARAFORMER_MODEL_DIR)
    : homeDir
      ? join(homeDir, '.config', 'hive', DEFAULT_PARAFORMER_MODEL_DIR_NAME)
      : null
  if (!modelDir) return null
  if (!existsSync(modelDir)) return null

  let entries: string[]
  try {
    entries = readdirSync(modelDir).sort((a, b) => a.localeCompare(b))
  } catch (error) {
    logger?.warn(`failed to scan Paraformer model directory: ${modelDir}`, error)
    return null
  }

  const tokens = join(modelDir, configuredTokens ? basename(configuredTokens) : 'tokens.txt')
  const modelFile =
    entries.find((name) => name.endsWith('.int8.onnx')) ??
    entries.find((name) => name.endsWith('.onnx'))
  if (!modelFile || !existsSync(tokens)) return null
  return { model: join(modelDir, modelFile), tokens }
}

const resolveWhisperCppModel = (
  env: NodeJS.ProcessEnv,
  logger?: Pick<HiveLogger, 'warn'>
): string | null => {
  const model = env.HIVE_STT_WHISPER_CPP_MODEL ?? env.WHISPER_CPP_MODEL
  if (model) {
    const absolute = resolve(model)
    return existsSync(absolute) ? absolute : null
  }
  const homeDir = getHomeDir(env)
  if (!homeDir) return null
  const modelDir = join(homeDir, '.config', 'hive', 'whisper-models')
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

const normalizeTranscriptForPromptEcho = (text: string) =>
  text.replace(/[^\p{L}\p{N}]/gu, '').trim()

const normalizeTranscriptForNoSpeech = (text: string) =>
  text.replace(/\s+/g, '').replace(/[，。！？、,.!?;；:："'“”‘’（）()【】[\]{}<>《》…—-]/g, '')

const isEmptyOrPunctuationOnlyTranscript = (text: string) =>
  normalizeTranscriptForNoSpeech(text).length === 0

const isSilentAudioHallucination = (text: string) => {
  const normalized = normalizeTranscriptForPromptEcho(text)
  if (!normalized) return true
  return SILENT_AUDIO_HALLUCINATION_PHRASES.some((phrase) => {
    const normalizedPhrase = normalizeTranscriptForPromptEcho(phrase)
    return normalized === normalizedPhrase || normalized.includes(normalizedPhrase)
  })
}

const countTeamNameMentions = (normalized: string) => {
  let count = 0
  for (const name of TEAM_MEMBER_NAMES) {
    let cursor = 0
    while (cursor < normalized.length) {
      const index = normalized.indexOf(name, cursor)
      if (index === -1) break
      count += 1
      cursor = index + name.length
    }
  }
  return count
}

const stripPromptEchoNoise = (normalized: string) => {
  let residual = normalized
  for (const name of TEAM_MEMBER_NAMES) {
    residual = residual.replaceAll(name, '')
  }
  for (const fragment of PROMPT_ECHO_NOISE_FRAGMENTS) {
    residual = residual.replaceAll(fragment, '')
  }
  return residual
}

const hasActionResidual = (residual: string) =>
  PROMPT_ECHO_ACTION_FRAGMENTS.some((fragment) => residual.includes(fragment))

const isTeamNamePromptEcho = (normalized: string) => {
  const teamMentionCount = countTeamNameMentions(normalized)
  if (teamMentionCount < MIN_TEAM_NAME_ECHO_COUNT) return false
  const residual = stripPromptEchoNoise(normalized)
  if (hasActionResidual(residual)) return false
  return residual.length <= MAX_PROMPT_ECHO_RESIDUAL_CHARS
}

export const isDefaultPromptEcho = (text: string) => {
  const normalized = normalizeTranscriptForPromptEcho(text)
  if (normalized.length < MIN_PROMPT_ECHO_CHARS) return false
  const normalizedPrompt = normalizeTranscriptForPromptEcho(DEFAULT_STT_PROMPT)
  if (normalizedPrompt.includes(normalized) || normalized.includes(normalizedPrompt)) return true
  if (isTeamNamePromptEcho(normalized)) return true

  const promptTokenCharacters = new Set(
    PROMPT_ECHO_CONTENT_TOKENS.join('').split('').filter(Boolean)
  )
  const nonPromptCharacters = normalized
    .split('')
    .filter((character) => !promptTokenCharacters.has(character))
  const matchedTokens = PROMPT_ECHO_CONTENT_TOKENS.filter((token) => normalized.includes(token))
  if (matchedTokens.length < MIN_PROMPT_ECHO_TOKEN_COUNT) return false
  const tokenCoverage = matchedTokens.join('').length / normalized.length
  return tokenCoverage >= PROMPT_ECHO_TOKEN_OVERLAP_RATIO && nonPromptCharacters.length === 0
}

type TranscriptQualityDecision =
  | {
      action: 'allow'
      metrics: Record<string, unknown>
      reason: 'text_quality_ok'
    }
  | {
      action: 'drop'
      metrics: Record<string, unknown>
      reason:
        | 'conservative_gibberish_text'
        | 'empty_or_punctuation'
        | 'known_silent_audio_hallucination'
        | 'prompt_echo'
    }

const findConservativeGibberishFragments = (text: string) => {
  const normalized = normalizeTranscriptForPromptEcho(text)
  return CONSERVATIVE_GIBBERISH_TEXT_FRAGMENTS.filter((fragment) => normalized.includes(fragment))
}

const isConservativeGibberishTranscript = (text: string) =>
  findConservativeGibberishFragments(text).length >= 2

const assessTranscriptQuality = (text: string): TranscriptQualityDecision => {
  const normalized = normalizeTranscriptForPromptEcho(text)
  const gibberishFragments = findConservativeGibberishFragments(text)
  const baseMetrics = {
    chars: normalized.length,
    confidence_available: false,
    gibberish_fragments: gibberishFragments,
  }

  if (isEmptyOrPunctuationOnlyTranscript(text)) {
    return { action: 'drop', metrics: baseMetrics, reason: 'empty_or_punctuation' }
  }
  if (isSilentAudioHallucination(text)) {
    return { action: 'drop', metrics: baseMetrics, reason: 'known_silent_audio_hallucination' }
  }
  if (isDefaultPromptEcho(text)) {
    return { action: 'drop', metrics: baseMetrics, reason: 'prompt_echo' }
  }
  if (isConservativeGibberishTranscript(text)) {
    return { action: 'drop', metrics: baseMetrics, reason: 'conservative_gibberish_text' }
  }
  return { action: 'allow', metrics: baseMetrics, reason: 'text_quality_ok' }
}

const logTranscriptQualityDecision = (
  logger: LocalSttProviderOptions['logger'],
  provider: LocalSttProviderName,
  text: string,
  decision: TranscriptQualityDecision
) => {
  const compactText = text.replace(/\s+/g, ' ').trim().slice(0, 160)
  const message = `local STT transcript quality provider=${provider} decision=${decision.action} reason=${decision.reason} text=${JSON.stringify(compactText)} metrics=${JSON.stringify(decision.metrics)}`
  const log = logger?.info ?? logger?.warn
  log?.(message)
}

export const createLocalSttProvider = (options: LocalSttProviderOptions = {}): LocalSttProvider => {
  const env = options.env ?? process.env
  const tempRoot = options.tempRoot ?? tmpdir()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const detectCandidates = (): LocalSttCli[] => {
    const candidates: LocalSttCli[] = []
    const paraformerModel = resolveParaformerModel(env, options.logger)
    if (paraformerModel) {
      candidates.push({
        command: 'sherpa-onnx',
        model: paraformerModel.model,
        provider: 'paraformer',
        tokens: paraformerModel.tokens,
      })
    }

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

  const createParaformerConfig = (cli: LocalSttCli) => ({
    decodingMethod: env.HIVE_STT_PARAFORMER_DECODING_METHOD ?? 'greedy_search',
    featConfig: {
      featureDim: 80,
      sampleRate: 16000,
    },
    modelConfig: {
      debug: false,
      numThreads: Number.parseInt(env.HIVE_STT_PARAFORMER_NUM_THREADS ?? '2', 10),
      paraformer: {
        model: cli.model,
      },
      provider: env.HIVE_STT_PARAFORMER_PROVIDER ?? 'cpu',
      tokens: cli.tokens,
    },
  })

  const loadParaformerRecognizer = async (
    key: string,
    config: ReturnType<typeof createParaformerConfig>
  ): Promise<ParaformerRecognizerCache> => {
    const existingLoad = paraformerRecognizerLoads.get(key)
    if (existingLoad) return existingLoad

    const promise = (async () => {
      const runtime = await (options.loadSherpaOnnx ?? defaultLoadSherpaOnnx)()
      const recognizer =
        runtime.createOfflineRecognizer?.(config) ??
        (runtime.OfflineRecognizer ? new runtime.OfflineRecognizer(config) : null)
      if (!recognizer) {
        throw new Error('sherpa-onnx offline recognizer is unavailable')
      }

      return {
        activeStreams: 0,
        freeWhenIdle: false,
        freed: false,
        key,
        recognizer,
        runtime,
      }
    })()

    paraformerRecognizerLoads.set(key, promise)
    try {
      return await promise
    } finally {
      if (paraformerRecognizerLoads.get(key) === promise) paraformerRecognizerLoads.delete(key)
    }
  }

  const acquireParaformerRecognizer = async (
    cli: LocalSttCli
  ): Promise<ParaformerRecognizerLease> => {
    const config = createParaformerConfig(cli)
    const key = JSON.stringify(config)
    const cache =
      paraformerRecognizerCache?.key === key && !paraformerRecognizerCache.freed
        ? paraformerRecognizerCache
        : await loadParaformerRecognizer(key, config)
    cache.activeStreams += 1
    if (paraformerRecognizerCache !== cache) {
      const previous = paraformerRecognizerCache
      paraformerRecognizerCache = cache
      if (previous && previous.key !== key) retireParaformerRecognizer(previous)
    }
    return {
      recognizer: cache.recognizer,
      release: () => releaseParaformerRecognizer(cache),
      runtime: cache.runtime,
    }
  }

  const convertAudioTo16kWav = async (audioPath: string, outputDir: string) => {
    const ffmpeg = findExecutable('ffmpeg', env)
    if (!ffmpeg) {
      throw new Error('ffmpeg is required to convert audio for local STT')
    }
    const wavPath = join(outputDir, `${parse(audioPath).name}.wav`)
    await execFileP(
      ffmpeg,
      ['-i', audioPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', '-y', wavPath],
      { maxBuffer: 5 * 1024 * 1024, timeout: timeoutMs }
    )
    return wavPath
  }

  const runParaformer = async (cli: LocalSttCli, audioPath: string): Promise<string | null> => {
    if (!cli.model || !cli.tokens) return null
    const outputDir = mkdtempSync(join(tempRoot, 'hive-local-stt-'))
    try {
      const wavPath = await convertAudioTo16kWav(audioPath, outputDir)
      const recognizerLease = await acquireParaformerRecognizer(cli)
      let stream: SherpaOfflineStream | null = null
      try {
        stream = recognizerLease.recognizer.createStream()
        if (stream.acceptWaveFile) {
          stream.acceptWaveFile(wavPath)
        } else {
          const wave = recognizerLease.runtime.readWave?.(wavPath)
          if (!wave) throw new Error('sherpa-onnx readWave is unavailable')
          if (!stream.acceptWaveform) {
            throw new Error('sherpa-onnx offline stream cannot accept waveform')
          }
          stream.acceptWaveform(wave.sampleRate, wave.samples)
        }

        recognizerLease.recognizer.decode(stream)
        const result = recognizerLease.recognizer.getResult(stream)
        const text = typeof result === 'string' ? result : result?.text
        return text?.trim() ? text.trim() : null
      } finally {
        try {
          stream?.free?.()
        } finally {
          recognizerLease.release()
        }
      }
    } finally {
      rmSync(outputDir, { force: true, recursive: true })
    }
  }

  const runWhisperCli = async (cli: LocalSttCli, audioPath: string): Promise<string | null> => {
    if (!cli.model) return null
    const outputDir = mkdtempSync(join(tempRoot, 'hive-local-stt-'))
    try {
      const wavPath = await convertAudioTo16kWav(audioPath, outputDir)
      const outputBase = join(outputDir, parse(wavPath).name)
      const { stdout } = await execFileP(
        cli.command,
        [
          '-m',
          cli.model,
          '-l',
          DEFAULT_STT_LANGUAGE,
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
          '--language',
          DEFAULT_STT_LANGUAGE,
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
            cli.provider === 'paraformer'
              ? await runParaformer(cli, audioPath)
              : cli.provider === 'whisper-cli'
                ? await runWhisperCli(cli, audioPath)
                : await runWhisper(cli, audioPath)
          if (text) {
            const decision = assessTranscriptQuality(text)
            logTranscriptQualityDecision(options.logger, cli.provider, text, decision)
            if (decision.action === 'drop') return null
            return { provider: cli.provider, text }
          }
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
