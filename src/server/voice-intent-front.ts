import {
  FAST_VOICE_REPLY_TIMEOUT_MS,
  GLM_FAST_VOICE_REPLY_BASE_URL,
  GLM_FAST_VOICE_REPLY_MODEL,
} from './fast-voice-reply.js'

export type VoiceIntentCompleteness = 'complete' | 'incomplete' | 'likely_complete'
export type VoiceIntentAction = 'clarify' | 'drop' | 'escalate' | 'handled'

export type VoiceIntentProviderInput = {
  callId?: string
  context?: string
  generation?: number
  isFinal?: boolean
  partialSeq: number
  transcript: string
  turnId: string
}

export type VoiceIntentVerdict = {
  action: VoiceIntentAction
  completeness: VoiceIntentCompleteness
  confidence: number
  distilled_intent: string
  intent_generation: number
  reason: string
  reply_text: string
  should_speculate_tts: boolean
}

export type VoiceIntentVerdictProvider = {
  evaluate(input: VoiceIntentProviderInput, signal?: AbortSignal): Promise<unknown>
}

export type VoiceIntentCandidate = {
  action: VoiceIntentAction
  completeness: VoiceIntentCompleteness
  confidence: number
  distilledIntent: string
  intentGeneration: number
  replyText: string
  shouldSpeculateTts: boolean
  transcript: string
}

export type VoiceIntentHandoff = {
  confidence: number
  distilledIntent: string
  intentGeneration: number
  transcript: string
  turnId: string
}

export type VoiceIntentSessionUpdate =
  | {
      candidate?: VoiceIntentCandidate
      handoff?: VoiceIntentHandoff
      status: 'accepted'
      verdict: VoiceIntentVerdict
    }
  | { status: 'disabled' | 'superseded' | 'throttled' }

export type VoiceIntentThrottleConfig = {
  handoffConfidenceThreshold: number
  minFirstChars: number
  minIntervalMs: number
  minNewChars: number
}

type EnvLike = Record<string, string | undefined>

type CreateGlmVoiceIntentVerdictProviderOptions = {
  apiKey?: string
  baseUrl?: string
  fetchImpl?: typeof fetch
  model?: string
  timeoutMs?: number
}

type CreateVoiceIntentSessionOptions = {
  callId?: string
  config?: Partial<VoiceIntentThrottleConfig>
  env?: EnvLike
  provider: VoiceIntentVerdictProvider
  turnId: string
}

type EvaluateVoiceIntentInput = {
  context?: string
  isFinal?: boolean
  nowMs?: number
  partialSeq: number
  transcript: string
}

type StrictVoiceIntentVerdictRecord = {
  action: VoiceIntentAction
  completeness: VoiceIntentCompleteness
  confidence: number
  distilled_intent: string
  intent_generation: number
  reply_text: string
  should_speculate_tts: boolean
  reason?: unknown
}

type AcceptedVoiceIntentSessionUpdate = Extract<VoiceIntentSessionUpdate, { status: 'accepted' }>

export const DEFAULT_VOICE_INTENT_THROTTLE: VoiceIntentThrottleConfig = {
  handoffConfidenceThreshold: 0.75,
  minFirstChars: 8,
  minIntervalMs: 600,
  minNewChars: 6,
}

const VOICE_INTENT_SYSTEM_PROMPT =
  '你是 HippoTeam 实时语音前台的意图判定器。你会收到用户正在说的话,可能是 partial 也可能是 final。' +
  '你必须只输出严格 JSON,不能输出 Markdown、解释、代码块或多余文本。JSON 字段固定为:' +
  '{"completeness":"incomplete|likely_complete|complete","action":"handled|escalate|clarify|drop","confidence":0到1,' +
  '"intent_generation":数字,"distilled_intent":"完整意图","reply_text":"给用户听的短回复","should_speculate_tts":布尔值}。' +
  '规则: 用户话还没说完时 completeness=incomplete 或 likely_complete; 只有语义完整时才能 complete。' +
  '只有用户要求真实操作、派工、改代码、部署、重启或 PM 决策时 action=escalate; 普通状态问答/闲聊 action=handled; 听不清 action=clarify; 噪声或无意义 action=drop。' +
  'distilled_intent 只在 complete 时写成一句完整、可交给 PM 的意图; 非 complete 时留空或写当前理解。'

const normalizeTranscript = (text: string) => text.replace(/\s+/g, '').trim()

const clampConfidence = (value: unknown) => {
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numberValue)) return 0
  return Math.min(1, Math.max(0, numberValue))
}

const normalizeIntentText = (value: unknown) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 500) : ''

const normalizeReplyText = (value: unknown) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 180) : ''

const isVoiceIntentCompleteness = (value: unknown): value is VoiceIntentCompleteness =>
  value === 'complete' || value === 'incomplete' || value === 'likely_complete'

const isVoiceIntentAction = (value: unknown): value is VoiceIntentAction =>
  value === 'clarify' || value === 'drop' || value === 'escalate' || value === 'handled'

const hasStrictVerdictSchema = (
  record: Record<string, unknown>
): record is StrictVoiceIntentVerdictRecord =>
  isVoiceIntentCompleteness(record.completeness) &&
  isVoiceIntentAction(record.action) &&
  typeof record.confidence === 'number' &&
  Number.isFinite(record.confidence) &&
  typeof record.intent_generation === 'number' &&
  Number.isFinite(record.intent_generation) &&
  typeof record.distilled_intent === 'string' &&
  typeof record.reply_text === 'string' &&
  typeof record.should_speculate_tts === 'boolean'

const extractJsonObject = (rawText: string) => {
  const trimmed = rawText.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

const readGlmContent = (response: unknown) => {
  const choices = (response as { choices?: unknown })?.choices
  if (!Array.isArray(choices)) return ''
  const content = (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content
  return typeof content === 'string' ? content : ''
}

export const createSafeVoiceIntentVerdict = (
  input: Partial<VoiceIntentProviderInput>,
  reason = 'safe_default'
): VoiceIntentVerdict => ({
  action: 'drop',
  completeness: 'incomplete',
  confidence: 0,
  distilled_intent: '',
  intent_generation: input.generation ?? 0,
  reason,
  reply_text: '',
  should_speculate_tts: false,
})

const normalizeVoiceIntentVerdict = (value: unknown, input: Partial<VoiceIntentProviderInput>) => {
  if (!value || typeof value !== 'object')
    return createSafeVoiceIntentVerdict(input, 'invalid_json')
  const record = value as Record<string, unknown>
  if (!hasStrictVerdictSchema(record)) {
    return createSafeVoiceIntentVerdict(input, 'invalid_schema')
  }

  return {
    action: record.action,
    completeness: record.completeness,
    confidence: clampConfidence(record.confidence),
    distilled_intent: normalizeIntentText(record.distilled_intent),
    intent_generation: Math.trunc(record.intent_generation),
    reason: normalizeIntentText(record.reason) || 'glm_verdict',
    reply_text: normalizeReplyText(record.reply_text),
    should_speculate_tts: record.should_speculate_tts,
  } satisfies VoiceIntentVerdict
}

export const parseVoiceIntentVerdict = (
  rawText: string,
  input: Partial<VoiceIntentProviderInput>
) => normalizeVoiceIntentVerdict(extractJsonObject(rawText), input)

export const isVoiceIntentFrontEnabled = (env: EnvLike = process.env) => {
  const value = env.HIVE_VOICE_INTENT_FRONT?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

const buildUserPrompt = (input: VoiceIntentProviderInput) => {
  const lines = [
    `turn_id: ${input.turnId}`,
    `call_id: ${input.callId ?? 'unknown'}`,
    `partial_seq: ${input.partialSeq}`,
    `is_final: ${input.isFinal === true ? 'true' : 'false'}`,
    `intent_generation_hint: ${input.generation ?? 0}`,
  ]
  const context = input.context?.trim()
  if (context) lines.push(`context:\n${context.slice(0, 1200)}`)
  lines.push(`transcript:\n${input.transcript}`)
  return lines.join('\n\n')
}

export const createGlmVoiceIntentVerdictProvider = (
  options: CreateGlmVoiceIntentVerdictProviderOptions = {}
): VoiceIntentVerdictProvider => {
  const apiKey = options.apiKey ?? process.env.GLM_API_KEY
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const baseUrl = (options.baseUrl ?? process.env.GLM_BASE_URL ?? GLM_FAST_VOICE_REPLY_BASE_URL)
    .replace(/\/+$/u, '')
    .trim()
  const model = options.model ?? process.env.GLM_FAST_MODEL ?? GLM_FAST_VOICE_REPLY_MODEL
  const timeoutMs = options.timeoutMs ?? FAST_VOICE_REPLY_TIMEOUT_MS

  return {
    async evaluate(input, signal) {
      if (!apiKey || !fetchImpl || !input.transcript.trim()) {
        return createSafeVoiceIntentVerdict(input, 'missing_provider_input')
      }

      const controller = new AbortController()
      const abort = () => controller.abort()
      signal?.addEventListener('abort', abort, { once: true })
      const timeout = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          body: JSON.stringify({
            max_tokens: 220,
            messages: [
              { content: VOICE_INTENT_SYSTEM_PROMPT, role: 'system' },
              { content: buildUserPrompt(input), role: 'user' },
            ],
            model,
            thinking: { type: 'disabled' },
          }),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          method: 'POST',
          signal: controller.signal,
        })
        const json = await response.json()
        return parseVoiceIntentVerdict(readGlmContent(json), input)
      } catch {
        return createSafeVoiceIntentVerdict(input, 'provider_failed')
      } finally {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', abort)
      }
    },
  }
}

export const shouldEvaluateVoiceIntent = (input: {
  config?: VoiceIntentThrottleConfig
  isFinal?: boolean
  lastEvaluatedText: string
  lastEvaluationAtMs: null | number
  nowMs: number
  transcript: string
}) => {
  if (input.isFinal === true) return true
  const config = input.config ?? DEFAULT_VOICE_INTENT_THROTTLE
  const transcript = normalizeTranscript(input.transcript)
  if (!transcript) return false
  if (input.lastEvaluationAtMs === null) return transcript.length >= config.minFirstChars
  if (input.nowMs - input.lastEvaluationAtMs < config.minIntervalMs) return false
  const previous = normalizeTranscript(input.lastEvaluatedText)
  const newChars = transcript.startsWith(previous)
    ? transcript.length - previous.length
    : Math.max(0, transcript.length - previous.length)
  return newChars >= config.minNewChars
}

const semanticKeyForVerdict = (verdict: VoiceIntentVerdict, transcript: string) =>
  normalizeTranscript(verdict.distilled_intent || transcript)

const toCandidate = (
  verdict: VoiceIntentVerdict,
  transcript: string,
  intentGeneration: number
): VoiceIntentCandidate => ({
  action: verdict.action,
  completeness: verdict.completeness,
  confidence: verdict.confidence,
  distilledIntent: verdict.distilled_intent,
  intentGeneration,
  replyText: verdict.reply_text,
  shouldSpeculateTts: verdict.should_speculate_tts,
  transcript,
})

export const createVoiceIntentSession = (options: CreateVoiceIntentSessionOptions) => {
  const config = { ...DEFAULT_VOICE_INTENT_THROTTLE, ...options.config }
  const enabled = isVoiceIntentFrontEnabled(options.env)
  let currentAbort: AbortController | null = null
  let currentGeneration = 0
  let latestRequestId = 0
  let lastEvaluatedText = ''
  let lastEvaluationAtMs: null | number = null
  let lastSemanticKey = ''
  let hasHandedOff = false

  const abortCurrent = () => {
    currentAbort?.abort()
    currentAbort = null
  }

  return {
    close() {
      abortCurrent()
    },

    async evaluate(input: EvaluateVoiceIntentInput): Promise<VoiceIntentSessionUpdate> {
      if (!enabled) return { status: 'disabled' }
      const nowMs = input.nowMs ?? Date.now()
      if (
        !shouldEvaluateVoiceIntent({
          config,
          lastEvaluatedText,
          lastEvaluationAtMs,
          nowMs,
          transcript: input.transcript,
          ...(input.isFinal !== undefined ? { isFinal: input.isFinal } : {}),
        })
      ) {
        return { status: 'throttled' }
      }

      lastEvaluatedText = input.transcript
      lastEvaluationAtMs = nowMs
      abortCurrent()
      const controller = new AbortController()
      currentAbort = controller
      latestRequestId += 1
      const requestId = latestRequestId
      const verdictInput: VoiceIntentProviderInput = {
        generation: currentGeneration + 1,
        partialSeq: input.partialSeq,
        transcript: input.transcript,
        turnId: options.turnId,
        ...(options.callId !== undefined ? { callId: options.callId } : {}),
        ...(input.context !== undefined ? { context: input.context } : {}),
        ...(input.isFinal !== undefined ? { isFinal: input.isFinal } : {}),
      }

      let rawVerdict: unknown
      try {
        rawVerdict = await options.provider.evaluate(verdictInput, controller.signal)
      } catch {
        if (requestId !== latestRequestId) return { status: 'superseded' }
        rawVerdict = createSafeVoiceIntentVerdict(verdictInput, 'provider_failed')
      } finally {
        if (currentAbort === controller) currentAbort = null
      }
      if (requestId !== latestRequestId) return { status: 'superseded' }

      const verdict = normalizeVoiceIntentVerdict(rawVerdict, verdictInput)
      const semanticKey = semanticKeyForVerdict(verdict, input.transcript)
      if (semanticKey && semanticKey !== lastSemanticKey) {
        currentGeneration += 1
        lastSemanticKey = semanticKey
      }

      const candidate = toCandidate(verdict, input.transcript, currentGeneration)
      const update: AcceptedVoiceIntentSessionUpdate = {
        candidate,
        status: 'accepted',
        verdict: { ...verdict, intent_generation: currentGeneration },
      }

      if (
        !hasHandedOff &&
        verdict.completeness === 'complete' &&
        verdict.action === 'escalate' &&
        verdict.confidence >= config.handoffConfidenceThreshold
      ) {
        hasHandedOff = true
        update.handoff = {
          confidence: verdict.confidence,
          distilledIntent: verdict.distilled_intent,
          intentGeneration: currentGeneration,
          transcript: input.transcript,
          turnId: options.turnId,
        }
      }

      return update
    },
  }
}
