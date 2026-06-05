import { isDefaultPromptEcho } from './local-stt.js'

export const FAST_VOICE_REPLY_MODEL = 'claude-haiku-4-5'
export const GLM_FAST_VOICE_REPLY_MODEL = 'glm-5.1'
const GLM_READONLY_FAST_VOICE_REPLY_MODEL = 'glm-4-flash'
export const GLM_FAST_VOICE_REPLY_BASE_URL = 'https://open.bigmodel.cn/api/coding/paas/v4'
export const FAST_VOICE_REPLY_TIMEOUT_MS = 5000
const GLM_STRONG_FAST_VOICE_REPLY_MAX_TOKENS = 120
const GLM_READONLY_FAST_VOICE_REPLY_MAX_TOKENS = 80
export const FAST_VOICE_REPLY_FALLBACK_TEXTS: readonly [string, ...string[]] = [
  '好的，收到，正在处理，稍等。',
  '收到，我来处理，稍等一下。',
  '好，我先记下，马上处理。',
]
const FAST_VOICE_REPLY_HISTORY_LIMIT = 15
const FAST_VOICE_REPLY_HISTORY_TEXT_LIMIT = 240
const FAST_VOICE_REPLY_DISPATCH_LIMIT = 3

type VoiceFrontMode = 'readonly' | 'strong'

const STRONG_VOICE_FRONT_SYSTEM_PROMPT =
  '你是 HippoTeam 的真对话前台助手,代表团队在语音里跟用户实时对话。用简体中文口语、自然、简短(1-2句,每句尽量短,像打电话那样简短利落)回应。\n' +
  '你能做:基于给你的"当前状态摘要"和对话历史,直接、实在地回答用户关于项目进度、worker在干什么、orchestrator状态的问题;能闲聊、能澄清、能做简单判断。答得具体,别打官腔,别用"这个需要主管处理"这种空话填时间。\n' +
  '你不能:① 绝不声称你做了实际没做的事——不说"我已经做完了",不说"我已经派人了",也不说自己在安排、部署、重启；你没有派单、改代码、部署、执行的权限。② 不编造状态摘要里没有的信息(不知道就说"这个我得确认一下")。禁止任何声称自己派工、安排他人执行、攻坚、汇报安排或编排团队行动的话。\n' +
  '什么时候交给主管(escalate):只有当用户真的要求一个【动作】——派worker/改代码/部署/重启/拍板决策——且需要主管时才escalate。这时说一句自然短话(如"好,这个我转给主管,稍等"或"这个需要主管处理,我先转过去")然后就停,别反复刷废话。能从上下文回答的(进度/状态/简单问题/闲聊)一律自己handled,别动不动上交。\n' +
  '输出第一行必须是门卫标记:`HIVE_GLM_GATEKEEPER: handled` 或 `HIVE_GLM_GATEKEEPER: escalate`。能自己答全且不需真实动作=handled;需派工/改码/部署/重启/拍板=escalate。第二行起是给用户听的短回复。'

const READONLY_VOICE_FRONT_SYSTEM_PROMPT =
  '你是 HippoTeam 的只读知情前台语音助手。你可以根据最近对话历史、当前状态和上下文，用简体中文口语化回应用户关于进度、worker 状态、orchestrator 状态的问题，1-2 句，短而明确，不说套话。你只读、不下指令、不执行任务、不派工、不声称已经完成。你不能说“我会派 worker”“我来安排”“我让 Codex 去做”“我会攻坚”“我会汇报给相关人员安排行动”等声称自己编排或采取行动的话；你没有派单、安排、执行、汇报安排的权限。涉及派 worker、改代码、部署、重启或真实操作时，只能说“这个需要主管处理”这类极短对称传递话，最终补充由 orchestrator 回复。\n\n输出第一行必须是门卫标记：`HIVE_GLM_GATEKEEPER: handled` 或 `HIVE_GLM_GATEKEEPER: escalate`。只有你能完整回答且不需要任何真实操作时才用 handled；任何不确定、带派工/改代码/部署/重启/执行动作意味的请求必须用 escalate。第二行开始输出给用户听的短回复。'

export type FastVoiceReplyGatekeeperVerdict = 'handled' | 'escalate'
export type FastVoiceReplyDisposition = FastVoiceReplyGatekeeperVerdict | 'drop'

export type FastVoiceReplyHistoryItem = {
  role: 'assistant' | 'user'
  text: string
}

export type FastVoiceReplyProvider = {
  generate(input: {
    history?: FastVoiceReplyHistoryItem[]
    statusContext?: string
    transcript: string
  }): Promise<string | null>
}

export type FastVoiceReplyResult = {
  gatekeeper: FastVoiceReplyDisposition
  reply: string | null
}

type MobileChatMessageLike = {
  content_json?: unknown
  message_type?: unknown
}

type WorkerStatusLike = {
  id?: unknown
  name?: unknown
  pendingTaskCount?: unknown
  pending_task_count?: unknown
  role?: unknown
  status?: unknown
}

type DispatchStatusLike = {
  id?: unknown
  status?: unknown
  text?: unknown
  toAgentId?: unknown
  to_agent_id?: unknown
}

type FastVoiceReplyStore = {
  insertMobileChatMessage(
    workspaceId: string,
    direction: 'inbound' | 'outbound',
    messageType: string,
    contentJson: string
  ): unknown
  listMobileChatMessages?(
    workspaceId: string,
    since?: number,
    limit?: number
  ): MobileChatMessageLike[]
  listDispatches?(workspaceId: string): DispatchStatusLike[]
  listWorkers?(workspaceId: string): WorkerStatusLike[]
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
  frontMode?: VoiceFrontMode
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

const parseGatekeeperReply = (rawText: string) => {
  const trimmed = rawText.trim()
  const match = trimmed.match(/^HIVE_GLM_GATEKEEPER\s*:\s*(handled|escalate)\b\s*/iu)
  if (!match) return { reply: normalizeFastVoiceReply(trimmed), verdict: null }
  const verdict = match[1]?.toLowerCase() as FastVoiceReplyGatekeeperVerdict
  const reply = normalizeFastVoiceReply(trimmed.slice(match[0].length))
  return { reply, verdict }
}

const resolveVoiceFrontMode = (value: unknown): VoiceFrontMode =>
  typeof value === 'string' && value.trim().toLowerCase() === 'readonly' ? 'readonly' : 'strong'

const readNonEmptyEnvString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const pickFallbackReply = (transcript: string) => {
  const normalized = transcript.trim()
  const index = normalized.length % FAST_VOICE_REPLY_FALLBACK_TEXTS.length
  return FAST_VOICE_REPLY_FALLBACK_TEXTS[index] ?? FAST_VOICE_REPLY_FALLBACK_TEXTS[0]
}

export const appendFastReplyCoordination = (formattedPrompt: string, fastReplyText: string) => {
  const reply = fastReplyText.replace(/"/g, '\\"')
  return `${formattedPrompt}\n\n[协调] GLM 已经对用户回复了:"${reply}"。用户已听到这句。你只需补充 GLM 没回答到的、或需要你实际查证/操作的部分。简洁扼要，绝不重复 GLM 已说的内容。若 GLM 已充分回答，你可以回复“无需补充”，不要再展开。`
}

const buildSystemPrompt = (statusContext?: string, mode: VoiceFrontMode = 'strong') => {
  const context = statusContext?.trim()
  const systemPrompt =
    mode === 'readonly' ? READONLY_VOICE_FRONT_SYSTEM_PROMPT : STRONG_VOICE_FRONT_SYSTEM_PROMPT
  return context ? `${systemPrompt}\n\n当前状态摘要：\n${context}` : systemPrompt
}

const truncateHistoryText = (text: string) =>
  text.replace(/\s+/g, ' ').trim().slice(0, FAST_VOICE_REPLY_HISTORY_TEXT_LIMIT)

const truncateStatusText = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 80)

const extractHistoryText = (contentJson: unknown) => {
  if (typeof contentJson !== 'string') return null
  try {
    const parsed = JSON.parse(contentJson) as { text?: unknown }
    return typeof parsed.text === 'string' ? truncateHistoryText(parsed.text) : null
  } catch {
    return truncateHistoryText(contentJson)
  }
}

const toFastVoiceReplyHistoryItem = (
  message: MobileChatMessageLike
): FastVoiceReplyHistoryItem | null => {
  const text = extractHistoryText(message.content_json)
  if (!text) return null
  if (message.message_type === 'user_text') return { role: 'user', text }
  if (message.message_type === 'orch_reply') return { role: 'assistant', text }
  return null
}

const readFastVoiceReplyHistory = ({
  store,
  transcript,
  workspaceId,
}: {
  store: FastVoiceReplyStore
  transcript: string
  workspaceId: string
}) => {
  try {
    const messages = store.listMobileChatMessages?.(
      workspaceId,
      undefined,
      FAST_VOICE_REPLY_HISTORY_LIMIT
    )
    if (!messages) return []
    const history = messages
      .map(toFastVoiceReplyHistoryItem)
      .filter((item): item is FastVoiceReplyHistoryItem => item !== null)
    const last = history.at(-1)
    if (last?.role === 'user' && last.text === truncateHistoryText(transcript)) {
      history.pop()
    }
    return history
  } catch {
    return []
  }
}

const readFastVoiceReplyStatusContext = ({
  store,
  workspaceId,
}: {
  store: FastVoiceReplyStore
  workspaceId: string
}) => {
  try {
    if (!store.listWorkers && !store.listDispatches) return ''
    const workers = store.listWorkers?.(workspaceId) ?? []
    const workerById = new Map<string, string>()
    const workerSummary = workers
      .map((worker) => {
        if (typeof worker.id === 'string' && typeof worker.name === 'string') {
          workerById.set(worker.id, worker.name)
        }
        if (typeof worker.name !== 'string' || typeof worker.status !== 'string') return null
        const role = typeof worker.role === 'string' && worker.role.trim() ? `(${worker.role})` : ''
        const pending =
          typeof worker.pendingTaskCount === 'number'
            ? worker.pendingTaskCount
            : typeof worker.pending_task_count === 'number'
              ? worker.pending_task_count
              : 0
        return `${worker.name}${role}: ${worker.status}${pending > 0 ? `, pending ${pending}` : ''}`
      })
      .filter((line): line is string => line !== null)
      .slice(0, 12)

    const openDispatches = (store.listDispatches?.(workspaceId) ?? []).filter(
      (dispatch) => dispatch.status === 'queued' || dispatch.status === 'submitted'
    )
    const dispatchSummary = openDispatches.slice(0, FAST_VOICE_REPLY_DISPATCH_LIMIT).map((item) => {
      const targetId =
        typeof item.toAgentId === 'string'
          ? item.toAgentId
          : typeof item.to_agent_id === 'string'
            ? item.to_agent_id
            : ''
      const workerName = workerById.get(targetId) ?? (targetId || 'unknown worker')
      const status = typeof item.status === 'string' ? item.status : 'open'
      const text = typeof item.text === 'string' ? ` ${truncateStatusText(item.text)}` : ''
      return `${workerName} ${status}${text}`
    })

    const lines = []
    if (workerSummary.length > 0) lines.push(`Workers: ${workerSummary.join('; ')}`)
    if (store.listDispatches) {
      lines.push(
        openDispatches.length > 0
          ? `Orchestrator: 当前有 ${openDispatches.length} 个未完成派单`
          : 'Orchestrator: 暂无未完成派单'
      )
    }
    if (dispatchSummary.length > 0) lines.push(`Open dispatches: ${dispatchSummary.join('; ')}`)
    return lines.join('\n')
  } catch {
    return ''
  }
}

const insertFastVoiceReply = ({
  gatekeeper,
  reply,
  store,
  workspaceId,
}: {
  gatekeeper?: FastVoiceReplyGatekeeperVerdict
  reply: string
  store: FastVoiceReplyStore
  workspaceId: string
}) => {
  try {
    const content: {
      fast_reply: true
      gatekeeper?: FastVoiceReplyGatekeeperVerdict
      source: string
      text: string
    } = gatekeeper
      ? {
          fast_reply: true,
          gatekeeper,
          source: 'voice_fast_reply',
          text: reply,
        }
      : {
          fast_reply: true,
          source: 'voice_fast_reply',
          text: reply,
        }
    store.insertMobileChatMessage(workspaceId, 'outbound', 'orch_reply', JSON.stringify(content))
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
  const frontMode = resolveVoiceFrontMode(process.env.HIVE_VOICE_FRONT_MODE)

  return {
    async generate({ history = [], statusContext = '', transcript }) {
      const prompt = transcript.trim()
      if (!apiKey || !fetchImpl || !prompt) return null

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
          body: JSON.stringify({
            max_tokens: 80,
            messages: [
              ...history.map((item) => ({
                content: item.text,
                role: item.role,
              })),
              {
                content: `用户语音转写：${prompt}`,
                role: 'user',
              },
            ],
            model,
            system: buildSystemPrompt(statusContext, frontMode),
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
  const frontMode = options.frontMode ?? resolveVoiceFrontMode(process.env.HIVE_VOICE_FRONT_MODE)
  const model =
    options.model ??
    (frontMode === 'readonly'
      ? GLM_READONLY_FAST_VOICE_REPLY_MODEL
      : (readNonEmptyEnvString(process.env.HIVE_VOICE_STRONG_MODEL) ?? GLM_FAST_VOICE_REPLY_MODEL))
  const baseUrl = (options.baseUrl ?? process.env.GLM_BASE_URL ?? GLM_FAST_VOICE_REPLY_BASE_URL)
    .trim()
    .replace(/\/+$/, '')
  const timeoutMs = options.timeoutMs ?? FAST_VOICE_REPLY_TIMEOUT_MS
  const maxTokens =
    frontMode === 'readonly'
      ? GLM_READONLY_FAST_VOICE_REPLY_MAX_TOKENS
      : GLM_STRONG_FAST_VOICE_REPLY_MAX_TOKENS
  const thinkingOptions = frontMode === 'strong' ? { thinking: { type: 'disabled' } } : {}

  return {
    async generate({ history = [], statusContext = '', transcript }) {
      const prompt = transcript.trim()
      if (!apiKey || !fetchImpl || !prompt) return null

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          body: JSON.stringify({
            max_tokens: maxTokens,
            messages: [
              {
                content: buildSystemPrompt(statusContext, frontMode),
                role: 'system',
              },
              ...history.map((item) => ({
                content: item.text,
                role: item.role,
              })),
              {
                content: prompt,
                role: 'user',
              },
            ],
            model,
            ...thinkingOptions,
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
    const frontMode = resolveVoiceFrontMode(env.HIVE_VOICE_FRONT_MODE)
    return createGlmFastVoiceReplyProvider({
      apiKey: env.GLM_API_KEY,
      ...(env.GLM_BASE_URL ? { baseUrl: env.GLM_BASE_URL } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      frontMode,
      ...(frontMode !== 'readonly' && readNonEmptyEnvString(env.HIVE_VOICE_STRONG_MODEL)
        ? { model: readNonEmptyEnvString(env.HIVE_VOICE_STRONG_MODEL) as string }
        : {}),
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
  store: FastVoiceReplyStore
  text: string
  workspaceId: string
}) => {
  const result = await maybeInsertFastVoiceReplyWithGatekeeper({
    provider,
    source,
    store,
    text,
    workspaceId,
  })
  return result.reply
}

export const maybeInsertFastVoiceReplyWithGatekeeper = async ({
  provider = createFastVoiceReplyProvider(),
  source,
  store,
  text,
  workspaceId,
}: {
  provider?: FastVoiceReplyProvider
  source: unknown
  store: FastVoiceReplyStore
  text: string
  workspaceId: string
}): Promise<FastVoiceReplyResult> => {
  if (source !== 'voice') return { gatekeeper: 'escalate', reply: null }
  if (isDefaultPromptEcho(text)) return { gatekeeper: 'drop', reply: null }
  const history = readFastVoiceReplyHistory({ store, transcript: text, workspaceId })
  const statusContext = readFastVoiceReplyStatusContext({ store, workspaceId })
  try {
    const generated = await provider.generate({ history, statusContext, transcript: text })
    if (generated) {
      const parsed = parseGatekeeperReply(generated)
      const reply = parsed.reply || pickFallbackReply(text)
      const gatekeeper = parsed.verdict ?? 'escalate'
      const inserted = insertFastVoiceReply({
        ...(parsed.verdict ? { gatekeeper: parsed.verdict } : {}),
        reply,
        store,
        workspaceId,
      })
      return {
        gatekeeper: inserted ? gatekeeper : 'escalate',
        reply: inserted ? reply : null,
      }
    }
    const reply = pickFallbackReply(text)
    return {
      gatekeeper: 'escalate',
      reply: insertFastVoiceReply({ reply, store, workspaceId }) ? reply : null,
    }
  } catch {
    const reply = pickFallbackReply(text)
    return {
      gatekeeper: 'escalate',
      reply: insertFastVoiceReply({ reply, store, workspaceId }) ? reply : null,
    }
  }
}
