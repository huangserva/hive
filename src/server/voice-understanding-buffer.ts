import {
  appendFastReplyCoordination,
  type FastVoiceReplyProvider,
  maybeInsertFastVoiceReplyWithGatekeeper,
} from './fast-voice-reply.js'
import type { HiveLogger } from './logger.js'
import { getOrchestratorId } from './workspace-store-support.js'

export const DEFAULT_VOICE_UNDERSTANDING_WINDOW_MS = 1200

type VoiceUnderstandingStore = {
  getActiveRunByAgentId(workspaceId: string, agentId: string): unknown
  insertMobileChatMessage(
    workspaceId: string,
    direction: 'inbound' | 'outbound',
    messageType: string,
    contentJson: string
  ): unknown
  recordUserInput(
    workspaceId: string,
    orchestratorId: string,
    text: string,
    input?: { forwardToOrchestrator?: boolean }
  ): unknown
}

type VoiceUnderstandingLogger = Pick<HiveLogger, 'warn'> & Partial<Pick<HiveLogger, 'info'>>

type VoiceUnderstandingSegment = {
  arrivedAt: number
  text: string
}

type VoiceUnderstandingBuffer = {
  fastVoiceReplyProvider?: FastVoiceReplyProvider | undefined
  firstArrivedAt: number
  lastArrivedAt: number
  logger?: VoiceUnderstandingLogger | undefined
  segments: VoiceUnderstandingSegment[]
  store: VoiceUnderstandingStore
  timer: ReturnType<typeof setTimeout> | null
  windowMs: number
  workspaceId: string
}

type EnqueueVoiceUnderstandingInput = {
  fastVoiceReplyProvider?: FastVoiceReplyProvider | undefined
  logger?: VoiceUnderstandingLogger | undefined
  store: VoiceUnderstandingStore
  text: string
  windowMs?: number
  workspaceId: string
}

const buffers = new Map<string, VoiceUnderstandingBuffer>()

const isGlmGatekeeperEnabled = () => process.env.HIVE_GLM_GATEKEEPER !== '0'

const logInfo = (logger: VoiceUnderstandingLogger | undefined, message: string) => {
  if (logger?.info) {
    logger.info(message)
    return
  }
  console.info(message)
}

const logWarn = (
  logger: VoiceUnderstandingLogger | undefined,
  message: string,
  error?: unknown
) => {
  if (logger?.warn) {
    logger.warn(message, error)
    return
  }
  console.warn(message, error)
}

const compactLogText = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 180)

export const resolveVoiceUnderstandingWindowMs = (
  env: { [key: string]: string | undefined } = process.env as { [key: string]: string | undefined }
) => {
  const raw = env.HIVE_VOICE_UNDERSTANDING_WINDOW_MS
  if (raw === undefined || raw === '') return DEFAULT_VOICE_UNDERSTANDING_WINDOW_MS
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_VOICE_UNDERSTANDING_WINDOW_MS
}

const buildMobileVoicePrompt = (text: string) => `[来自手机 Mobile App]\n---\n${text}`

const persistInboundChatMessage = (
  buffer: VoiceUnderstandingBuffer,
  workspaceId: string,
  combinedText: string
) => {
  try {
    buffer.store.insertMobileChatMessage(
      workspaceId,
      'inbound',
      'user_text',
      JSON.stringify({ source: 'voice', text: combinedText })
    )
    return true
  } catch (error) {
    logWarn(
      buffer.logger,
      `voice understanding inbound chat persist failed workspace_id=${workspaceId}`,
      error
    )
    return false
  }
}

const recordVoiceInput = (
  buffer: VoiceUnderstandingBuffer,
  workspaceId: string,
  orchId: string,
  text: string,
  input?: { forwardToOrchestrator?: boolean }
) => {
  try {
    if (input === undefined) {
      buffer.store.recordUserInput(workspaceId, orchId, text)
    } else {
      buffer.store.recordUserInput(workspaceId, orchId, text, input)
    }
    return true
  } catch (error) {
    logWarn(
      buffer.logger,
      `voice understanding record user input failed workspace_id=${workspaceId}`,
      error
    )
    return false
  }
}

const flushVoiceUnderstandingBuffer = async (workspaceId: string) => {
  const buffer = buffers.get(workspaceId)
  if (!buffer) return
  buffers.delete(workspaceId)
  if (buffer.timer) clearTimeout(buffer.timer)

  const combinedText = buffer.segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
  if (!combinedText) return

  const now = Date.now()
  logInfo(
    buffer.logger,
    `voice understanding flush workspace_id=${workspaceId} segments=${buffer.segments.length} wait_ms=${now - buffer.lastArrivedAt} total_ms=${now - buffer.firstArrivedAt} text=${JSON.stringify(compactLogText(combinedText))}`
  )

  const orchId = getOrchestratorId(workspaceId)
  const formatted = buildMobileVoicePrompt(combinedText)
  if (!buffer.store.getActiveRunByAgentId(workspaceId, orchId)) {
    persistInboundChatMessage(buffer, workspaceId, combinedText)
    recordVoiceInput(buffer, workspaceId, orchId, formatted, { forwardToOrchestrator: false })
    logWarn(
      buffer.logger,
      `voice understanding flush persisted without forwarding workspace_id=${workspaceId} reason=orchestrator_not_running segments=${buffer.segments.length}`
    )
    return
  }

  let fastReply: Awaited<ReturnType<typeof maybeInsertFastVoiceReplyWithGatekeeper>>
  try {
    fastReply = await maybeInsertFastVoiceReplyWithGatekeeper({
      ...(buffer.fastVoiceReplyProvider ? { provider: buffer.fastVoiceReplyProvider } : {}),
      source: 'voice',
      store: buffer.store,
      text: combinedText,
      workspaceId,
    })
  } catch (error) {
    logWarn(
      buffer.logger,
      `voice understanding front reply failed workspace_id=${workspaceId}; forwarding raw voice input`,
      error
    )
    fastReply = { gatekeeper: 'escalate', reply: null }
  }
  if (fastReply.gatekeeper === 'drop') return

  persistInboundChatMessage(buffer, workspaceId, combinedText)

  const gatekeeperHandled =
    isGlmGatekeeperEnabled() && fastReply.gatekeeper === 'handled' && fastReply.reply !== null
  const promptForOrchestrator =
    isGlmGatekeeperEnabled() && fastReply.gatekeeper === 'escalate' && fastReply.reply !== null
      ? appendFastReplyCoordination(formatted, fastReply.reply)
      : formatted

  if (gatekeeperHandled) {
    recordVoiceInput(buffer, workspaceId, orchId, formatted, { forwardToOrchestrator: false })
  } else {
    recordVoiceInput(buffer, workspaceId, orchId, promptForOrchestrator)
  }
}

export const enqueueVoiceUnderstandingInput = async ({
  fastVoiceReplyProvider,
  logger,
  store,
  text,
  windowMs = resolveVoiceUnderstandingWindowMs(),
  workspaceId,
}: EnqueueVoiceUnderstandingInput) => {
  const trimmed = text.trim()
  if (!trimmed) return

  const now = Date.now()
  const existing = buffers.get(workspaceId)
  if (existing?.timer) clearTimeout(existing.timer)
  const buffer: VoiceUnderstandingBuffer = existing ?? {
    firstArrivedAt: now,
    lastArrivedAt: now,
    segments: [],
    store,
    timer: null,
    windowMs,
    workspaceId,
  }
  buffer.fastVoiceReplyProvider = fastVoiceReplyProvider
  buffer.logger = logger
  buffer.lastArrivedAt = now
  buffer.store = store
  buffer.windowMs = windowMs
  buffer.segments.push({ arrivedAt: now, text: trimmed })
  buffers.set(workspaceId, buffer)

  logInfo(
    logger,
    `voice understanding segment workspace_id=${workspaceId} segments=${buffer.segments.length} window_ms=${windowMs} arrived_at=${now} text=${JSON.stringify(compactLogText(trimmed))}`
  )

  if (windowMs === 0) {
    await flushVoiceUnderstandingBuffer(workspaceId)
    return
  }

  buffer.timer = setTimeout(() => {
    void flushVoiceUnderstandingBuffer(workspaceId)
  }, windowMs)
}

export const __resetVoiceUnderstandingBuffersForTests = () => {
  for (const buffer of buffers.values()) {
    if (buffer.timer) clearTimeout(buffer.timer)
  }
  buffers.clear()
}
