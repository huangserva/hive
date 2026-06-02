export const FAST_VOICE_REPLY_MODEL = 'claude-haiku-4-5'
export const FAST_VOICE_REPLY_TIMEOUT_MS = 2500

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

type CreateAnthropicFastVoiceReplyProviderOptions = {
  apiKey?: string
  fetchImpl?: typeof fetch
  model?: string
  timeoutMs?: number
}

export const normalizeFastVoiceReply = (text: string) =>
  text.replace(/\s+/g, ' ').trim().slice(0, 180)

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

export const maybeInsertFastVoiceReply = async ({
  provider = createAnthropicFastVoiceReplyProvider(),
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
    const reply = await provider.generate({ transcript: text })
    if (!reply) return null
    store.insertMobileChatMessage(
      workspaceId,
      'outbound',
      'orch_reply',
      JSON.stringify({ fast_reply: true, source: 'voice_fast_reply', text: reply })
    )
    return reply
  } catch {
    return null
  }
}
