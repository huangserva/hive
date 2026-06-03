export const FAST_VOICE_REPLY_MODEL = 'claude-haiku-4-5'
export const GLM_FAST_VOICE_REPLY_MODEL = 'glm-4-flash'
export const GLM_FAST_VOICE_REPLY_BASE_URL = 'https://open.bigmodel.cn/api/coding/paas/v4'
export const FAST_VOICE_REPLY_TIMEOUT_MS = 2500
export const FAST_VOICE_REPLY_FALLBACK_TEXTS: readonly [string, ...string[]] = [
  '好的，收到，正在处理，稍等。',
  '收到，我来处理，稍等一下。',
  '好，我先记下，马上处理。',
]

const FAST_VOICE_REPLY_SYSTEM_PROMPT =
  '你是 HippoTeam 的车载语音助手。用简体中文口语化回应，1-2 句，短而明确。不要长篇解释；如果用户是在安排任务，只先确认会去处理，不要声称已经完成。'

export type FastVoiceReplyProvider = {
  generate(input: { transcript: string }): Promise<string | null>
}

type AnthropicContentBlock = {
  text?: unknown
  type?: unknown
}

type AnthropicMessageResponse = {
  content?: unknown
}

type GlmChatCompletionResponse = {
  choices?: unknown
}

type GlmChoice = {
  message?: {
    content?: unknown
  }
}

type CreateAnthropicFastVoiceReplyProviderOptions = {
  apiKey?: string
  fetchImpl?: typeof fetch
  model?: string
  timeoutMs?: number
}

type CreateGlmFastVoiceReplyProviderOptions = {
  apiKey?: string
  baseUrl?: string
  fetchImpl?: typeof fetch
  model?: string
  timeoutMs?: number
}

type CreateFastVoiceReplyProviderOptions = {
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export const normalizeFastVoiceReply = (text: string) =>
  text.replace(/\s+/g, ' ').trim().slice(0, 180)

const pickFallbackReply = (transcript: string) => {
  const normalized = transcript.trim()
  const index = normalized.length % FAST_VOICE_REPLY_FALLBACK_TEXTS.length
  return FAST_VOICE_REPLY_FALLBACK_TEXTS[index] ?? FAST_VOICE_REPLY_FALLBACK_TEXTS[0]
}

const insertFastVoiceReply = ({
  reply,
  store,
  workspaceId,
}: {
  reply: string
  store: {
    insertMobileChatMessage(
      workspaceId: string,
      direction: 'inbound' | 'outbound',
      messageType: string,
      contentJson: string
    ): unknown
  }
  workspaceId: string
}) => {
  try {
    store.insertMobileChatMessage(
      workspaceId,
      'outbound',
      'orch_reply',
      JSON.stringify({ fast_reply: true, source: 'voice_fast_reply', text: reply })
    )
    return true
  } catch {
    return false
  }
}

const extractAnthropicText = (body: AnthropicMessageResponse) => {
  if (!Array.isArray(body.content)) return null
  const text = body.content
    .map((block: AnthropicContentBlock) =>
      block && block.type === 'text' && typeof block.text === 'string' ? block.text : ''
    )
    .join('')
  const normalized = normalizeFastVoiceReply(text)
  return normalized ? normalized : null
}

const extractGlmText = (body: GlmChatCompletionResponse) => {
  if (!Array.isArray(body.choices)) return null
  const firstChoice = body.choices[0] as GlmChoice | undefined
  const content = firstChoice?.message?.content
  if (typeof content !== 'string') return null
  const normalized = normalizeFastVoiceReply(content)
  return normalized ? normalized : null
}

export const createAnthropicFastVoiceReplyProvider = (
  options: CreateAnthropicFastVoiceReplyProviderOptions = {}
): FastVoiceReplyProvider => {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const model = options.model ?? FAST_VOICE_REPLY_MODEL
  const timeoutMs = options.timeoutMs ?? FAST_VOICE_REPLY_TIMEOUT_MS

  return {
    async generate({ transcript }) {
      const prompt = transcript.trim()
      if (!apiKey || !fetchImpl || !prompt) return null

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
          body: JSON.stringify({
            max_tokens: 80,
            messages: [
              {
                content: `用户语音转写：${prompt}`,
                role: 'user',
              },
            ],
            model,
            system: FAST_VOICE_REPLY_SYSTEM_PROMPT,
            temperature: 0.2,
          }),
          headers: {
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            'x-api-key': apiKey,
          },
          method: 'POST',
          signal: controller.signal,
        })
        if (!response.ok) return null
        return extractAnthropicText((await response.json()) as AnthropicMessageResponse)
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

export const createGlmFastVoiceReplyProvider = (
  options: CreateGlmFastVoiceReplyProviderOptions = {}
): FastVoiceReplyProvider => {
  const apiKey = options.apiKey ?? process.env.GLM_API_KEY
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const model = options.model ?? process.env.GLM_FAST_MODEL ?? GLM_FAST_VOICE_REPLY_MODEL
  const baseUrl = (options.baseUrl ?? process.env.GLM_BASE_URL ?? GLM_FAST_VOICE_REPLY_BASE_URL)
    .trim()
    .replace(/\/+$/, '')
  const timeoutMs = options.timeoutMs ?? FAST_VOICE_REPLY_TIMEOUT_MS

  return {
    async generate({ transcript }) {
      const prompt = transcript.trim()
      if (!apiKey || !fetchImpl || !prompt) return null

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          body: JSON.stringify({
            max_tokens: 80,
            messages: [
              {
                content: FAST_VOICE_REPLY_SYSTEM_PROMPT,
                role: 'system',
              },
              {
                content: prompt,
                role: 'user',
              },
            ],
            model,
          }),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          method: 'POST',
          signal: controller.signal,
        })
        if (!response.ok) return null
        return extractGlmText((await response.json()) as GlmChatCompletionResponse)
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

const createNullFastVoiceReplyProvider = (): FastVoiceReplyProvider => ({
  async generate() {
    return null
  },
})

export const createFastVoiceReplyProvider = (
  options: CreateFastVoiceReplyProviderOptions = {}
): FastVoiceReplyProvider => {
  const env = options.env ?? process.env
  if (env.GLM_API_KEY) {
    return createGlmFastVoiceReplyProvider({
      apiKey: env.GLM_API_KEY,
      ...(env.GLM_BASE_URL ? { baseUrl: env.GLM_BASE_URL } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(env.GLM_FAST_MODEL ? { model: env.GLM_FAST_MODEL } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    })
  }
  if (env.ANTHROPIC_API_KEY) {
    return createAnthropicFastVoiceReplyProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    })
  }
  return createNullFastVoiceReplyProvider()
}

export const maybeInsertFastVoiceReply = async ({
  provider = createFastVoiceReplyProvider(),
  source,
  store,
  text,
  workspaceId,
}: {
  provider?: FastVoiceReplyProvider
  source: unknown
  store: {
    insertMobileChatMessage(
      workspaceId: string,
      direction: 'inbound' | 'outbound',
      messageType: string,
      contentJson: string
    ): unknown
  }
  text: string
  workspaceId: string
}) => {
  if (source !== 'voice') return null
  try {
    const reply = (await provider.generate({ transcript: text })) ?? pickFallbackReply(text)
    return insertFastVoiceReply({ reply, store, workspaceId }) ? reply : null
  } catch {
    const reply = pickFallbackReply(text)
    return insertFastVoiceReply({ reply, store, workspaceId }) ? reply : null
  }
}
