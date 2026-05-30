import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import type { Readable } from 'node:stream'
import type { EventHandles } from '@larksuiteoapi/node-sdk'
import * as lark from '@larksuiteoapi/node-sdk'

import type {
  FeishuApprovalDecision,
  FeishuApprovalRisk,
  ResolvedApproval,
} from './feishu-approval-ledger.js'
import type { FeishuCredentials } from './feishu-credentials.js'
import { type FeishuInboundChatEvent, handleFeishuInbound } from './feishu-inbound-handler.js'
import { FeishuReactionStore } from './feishu-reaction-store.js'
import { resolveRoute } from './feishu-route-resolver.js'
import {
  buildApprovalCard,
  buildResolvedApprovalCard,
  chunkFeishuText,
  type FeishuCardActionTriggerEvent,
  getCardActionOperator,
  getSenderUserId,
  parseApprovalCardAction,
  parseAudioContent,
  parseFileContent,
  parseImageContent,
  parseTextContent,
  stripLeadingMentions,
} from './feishu-transport-utils.js'
import { createLocalSttProvider, type LocalSttProvider } from './local-stt.js'
import type { HiveLogger } from './logger.js'
import { getUploadsDir } from './mobile-media-store.js'
import type { RuntimeStore } from './runtime-store.js'

type MessageReceiveEvent = Parameters<NonNullable<EventHandles['im.message.receive_v1']>>[0]
export type FeishuTransportState = 'connected' | 'disconnected' | 'error'

export interface FeishuOutboundTransport {
  addReaction(messageId: string, emoji: string): Promise<string>
  getLatestMessageForChat(chatId: string): string | undefined
  getLastChatForAgent(agentId: string): string | null
  getStatus(): { appId: string; reconnectCount: number; state: FeishuTransportState }
  markReplyDelivered(messageId: string): Promise<void>
  removeReaction(messageId: string, reactionId: string): Promise<void>
  sendApprovalCard(input: SendApprovalCardInput): Promise<{ messageId: string }>
  sendMessage(chatId: string, text: string): Promise<void>
  updateApprovalCard(input: UpdateApprovalCardInput): Promise<void>
}

export interface SendApprovalCardInput {
  action: string
  approvalId: string
  chatId: string
  risk: FeishuApprovalRisk
  target: string | null
  workspaceName: string
}

export interface UpdateApprovalCardInput {
  action: string
  approvalId: string
  decision: FeishuApprovalDecision
  messageId: string
  operator: string
  resolvedAt: number
}

interface FeishuTransportOptions {
  credentials: FeishuCredentials
  logger: HiveLogger
  localSttProvider?: LocalSttProvider
  onInboundChat?: (event: FeishuInboundChatEvent) => Promise<void> | void
  store: RuntimeStore
}

const MAX_RECONNECTS_BEFORE_ERROR = 10
const APPROVAL_LEDGER_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const APPROVAL_LEDGER_TTL_MS = 60 * 60 * 1000
const FEISHU_REACTION_RECEIVED_EMOJI = 'GLANCE'
const FEISHU_REACTION_DONE_EMOJI = 'OK'
const FEISHU_AUDIO_RECOGNIZE_ENGINE = '16k_auto'
const FEISHU_AUDIO_RECOGNIZE_FORMAT = 'opus'
const FEISHU_IMAGE_MAX_BYTES = 20 * 1024 * 1024
const FEISHU_IMAGE_FILE_EXTS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp'])

const stringifyFeishuError = (error: unknown) => {
  const response =
    error &&
    typeof error === 'object' &&
    'response' in error &&
    error.response &&
    typeof error.response === 'object'
      ? (error.response as { body?: unknown; code?: unknown; msg?: unknown })
      : null

  const details: Record<string, unknown> = {}
  if (error instanceof Error) {
    details.name = error.name
    details.message = error.message
    details.stack = error.stack
  }
  if (response) {
    details.response = {
      body: response.body,
      code: response.code,
      msg: response.msg,
    }
  }

  const ownPropertyNames =
    error && (typeof error === 'object' || typeof error === 'function')
      ? Object.getOwnPropertyNames(error)
      : []

  try {
    return JSON.stringify(Object.keys(details).length > 0 ? details : error, [
      ...new Set([
        ...ownPropertyNames,
        'body',
        'code',
        'message',
        'msg',
        'name',
        'response',
        'stack',
      ]),
    ])
  } catch {
    return String(error)
  }
}

const readableToBuffer = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export class FeishuTransport implements FeishuOutboundTransport {
  private readonly credentials: FeishuCredentials
  private readonly logger: HiveLogger
  private readonly localSttProvider: LocalSttProvider
  private readonly onInboundChat:
    | ((event: FeishuInboundChatEvent) => Promise<void> | void)
    | undefined
  private readonly store: RuntimeStore
  private readonly client: lark.Client
  private readonly lastChatByAgent = new Map<string, string>()
  private readonly reactionStore = new FeishuReactionStore()
  private reconnectCount = 0
  private state: FeishuTransportState = 'disconnected'
  private cleanupInterval: ReturnType<typeof setInterval> | null = null
  private wsClient: lark.WSClient | null = null

  constructor({
    credentials,
    localSttProvider,
    logger,
    onInboundChat,
    store,
  }: FeishuTransportOptions) {
    this.credentials = credentials
    this.logger = logger
    this.localSttProvider = localSttProvider ?? createLocalSttProvider({ logger })
    this.onInboundChat = onInboundChat
    this.store = store
    this.client = new lark.Client({
      appId: credentials.appId,
      appSecret: credentials.appSecret,
      domain: lark.Domain.Feishu,
      loggerLevel: lark.LoggerLevel.error,
    })
  }

  async start(): Promise<void> {
    const eventDispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (event) => {
        try {
          await this.handleMessageReceive(event)
        } catch (error) {
          this.logger.error(`feishu inbound handler failed chat_id=${event.message.chat_id}`, error)
        }
      },
      'card.action.trigger': async (event: FeishuCardActionTriggerEvent) => {
        try {
          return await this.handleCardAction(event)
        } catch (error) {
          this.logger.error('feishu card action handler failed', error)
          return { toast: { content: '审批处理失败，请稍后重试', type: 'error' } }
        }
      },
    })

    this.wsClient = new lark.WSClient({
      appId: this.credentials.appId,
      appSecret: this.credentials.appSecret,
      domain: lark.Domain.Feishu,
      handshakeTimeoutMs: 10_000,
      loggerLevel: lark.LoggerLevel.error,
      onError: (error) => {
        this.state = 'error'
        this.logger.error('feishu WSClient error', error)
      },
      onReady: () => {
        this.state = 'connected'
        this.reconnectCount = 0
        this.logger.info('feishu WSClient connected')
      },
      onReconnected: () => {
        this.state = 'connected'
        this.reconnectCount = 0
        this.logger.info('feishu WSClient connected')
      },
      onReconnecting: () => {
        this.state = 'disconnected'
        this.reconnectCount += 1
        this.logger.warn(
          `feishu WSClient disconnected, retrying reconnect_count=${this.reconnectCount}`
        )
        if (this.reconnectCount > MAX_RECONNECTS_BEFORE_ERROR) {
          this.logger.error(
            `feishu WSClient reconnecting repeatedly reconnect_count=${this.reconnectCount}`
          )
        }
      },
    })

    try {
      await this.wsClient.start({ eventDispatcher })
      this.startCleanupTimer()
    } catch (error) {
      this.state = 'error'
      throw error
    }
  }

  async stop(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.wsClient?.close()
    this.state = 'disconnected'
    this.wsClient = null
  }

  getStatus(): { appId: string; reconnectCount: number; state: FeishuTransportState } {
    return {
      appId: this.credentials.appId,
      reconnectCount: this.reconnectCount,
      state: this.state,
    }
  }

  getLastChatForAgent(agentId: string): string | null {
    return this.lastChatByAgent.get(agentId) ?? null
  }

  getLatestMessageForChat(chatId: string): string | undefined {
    return this.reactionStore.getLatestForChat(chatId)
  }

  async addReaction(messageId: string, emoji: string): Promise<string> {
    const response = await this.client.im.v1.messageReaction.create({
      data: {
        reaction_type: {
          emoji_type: emoji,
        },
      },
      path: {
        message_id: messageId,
      },
    })
    const reactionId = response.data?.reaction_id
    if (!reactionId) {
      throw new Error('Feishu reaction response missing reaction_id')
    }
    return reactionId
  }

  async removeReaction(messageId: string, reactionId: string): Promise<void> {
    await this.client.im.v1.messageReaction.delete({
      path: {
        message_id: messageId,
        reaction_id: reactionId,
      },
    })
  }

  async markReplyDelivered(messageId: string): Promise<void> {
    const oldReactionId = this.reactionStore.take(messageId)
    if (oldReactionId) {
      try {
        await this.removeReaction(messageId, oldReactionId)
      } catch (error) {
        this.logger.warn(
          `feishu reaction remove failed message_id=${messageId}`,
          stringifyFeishuError(error)
        )
      }
    }

    try {
      await this.addReaction(messageId, FEISHU_REACTION_DONE_EMOJI)
    } catch (error) {
      this.logger.warn(
        `feishu reaction add failed message_id=${messageId} emoji=${FEISHU_REACTION_DONE_EMOJI}`,
        stringifyFeishuError(error)
      )
    }
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const chunks = chunkFeishuText(text)

    if (chunks.length > 1) {
      this.logger.info(`feishu outbound chunked chat_id=${chatId} chunks=${chunks.length}`)
    }

    for (const chunk of chunks) {
      await this.client.im.v1.message.create({
        data: {
          content: JSON.stringify({ text: chunk }),
          msg_type: 'text',
          receive_id: chatId,
        },
        params: { receive_id_type: 'chat_id' },
      })
    }
  }

  async sendApprovalCard(input: SendApprovalCardInput): Promise<{ messageId: string }> {
    const response = await this.client.im.v1.message.create({
      data: {
        content: JSON.stringify(buildApprovalCard(input)),
        msg_type: 'interactive',
        receive_id: input.chatId,
      },
      params: { receive_id_type: 'chat_id' },
    })
    const messageId = response.data?.message_id
    if (!messageId) {
      throw new Error('Feishu approval card response missing message_id')
    }
    return { messageId }
  }

  async updateApprovalCard(input: UpdateApprovalCardInput): Promise<void> {
    await this.client.im.v1.message.patch({
      data: {
        content: JSON.stringify(buildResolvedApprovalCard(input)),
      },
      path: {
        message_id: input.messageId,
      },
    })
  }

  private async handleMessageReceive(event: MessageReceiveEvent): Promise<void> {
    const chatId = event.message.chat_id
    const messageId = event.message.message_id
    const senderUserId = getSenderUserId(event.sender)
    this.logger.info(`feishu inbound message chat_id=${chatId} sender=${senderUserId}`)

    const inboundText = await this.extractInboundText(event)
    if (inboundText === null) return

    const inboundEvent: FeishuInboundChatEvent = {
      chatId,
      ...(inboundText.imagePath ? { imagePath: inboundText.imagePath } : {}),
      ...(messageId ? { messageId } : {}),
      senderName: senderUserId,
      sourceType: inboundText.sourceType,
      text: inboundText.text,
      userId: senderUserId,
    }
    await this.onInboundChat?.(inboundEvent)

    const route = resolveRoute({
      bindingsStore: { findByChatId: this.store.findFeishuBindingByChatId },
      chatId,
      workspaceStore: this.store,
    })
    if ('reason' in route) {
      this.logger.info(`feishu inbound dropped reason=${route.reason} chat_id=${chatId}`)
      return
    }
    this.lastChatByAgent.set(route.orchestratorAgentId, chatId)
    if (messageId) {
      this.reactionStore.setLatestForChat(chatId, messageId)
      try {
        const reactionId = await this.addReaction(messageId, FEISHU_REACTION_RECEIVED_EMOJI)
        this.reactionStore.set(messageId, reactionId)
      } catch (error) {
        this.logger.warn(
          `feishu reaction add failed message_id=${messageId} emoji=${FEISHU_REACTION_RECEIVED_EMOJI}`,
          stringifyFeishuError(error)
        )
      }
    }

    await handleFeishuInbound({
      agentRuntime: this.store,
      event: inboundEvent,
      logger: this.logger,
      replyText: (replyChatId, textToSend) => this.sendMessage(replyChatId, textToSend),
      route,
      store: this.store,
    })
  }

  private extractText(event: MessageReceiveEvent): string | null {
    const { message } = event
    if (message.message_type !== 'text') {
      // TODO Phase 4+: support Feishu image/file/audio/sticker payloads.
      this.logger.info(
        `feishu inbound dropped reason=unsupported_message_type chat_id=${message.chat_id} message_type=${message.message_type}`
      )
      return null
    }

    let text: string | null = null
    try {
      text = parseTextContent(message.content)
    } catch (error) {
      this.logger.warn(
        `feishu inbound dropped reason=invalid_text_content chat_id=${message.chat_id}`,
        error
      )
      return null
    }
    if (text === null) {
      this.logger.info(`feishu inbound dropped reason=missing_text chat_id=${message.chat_id}`)
      return null
    }

    if (message.chat_type === 'group') {
      const mentions = message.mentions ?? []
      if (mentions.length === 0) {
        this.logger.info(
          `feishu inbound dropped reason=group_without_mention chat_id=${message.chat_id}`
        )
        return null
      }
      return stripLeadingMentions(text, mentions)
    }

    return text
  }

  private async extractInboundText(
    event: MessageReceiveEvent
  ): Promise<{ imagePath?: string; sourceType: 'image' | 'text' | 'voice'; text: string } | null> {
    const { message } = event
    if (message.message_type === 'audio') {
      const transcript = await this.extractAudioTranscript(event)
      return transcript ? { sourceType: 'voice', text: transcript } : null
    }
    if (message.message_type === 'image') {
      return this.extractInboundImage(event)
    }
    if (message.message_type === 'file') {
      return this.extractInboundImageFile(event)
    }
    const text = this.extractText(event)
    return text === null ? null : { sourceType: 'text', text }
  }

  private async extractInboundImage(
    event: MessageReceiveEvent
  ): Promise<{ imagePath?: string; sourceType: 'image'; text: string }> {
    const { message } = event
    let image: ReturnType<typeof parseImageContent> | null = null
    try {
      image = parseImageContent(message.content)
    } catch (error) {
      this.logger.warn(
        `feishu inbound image failed reason=invalid_image_content chat_id=${message.chat_id}`,
        error
      )
      return { sourceType: 'image', text: '收到图片但处理失败：图片消息格式无法解析。' }
    }
    if (!image) {
      this.logger.warn(
        `feishu inbound image failed reason=missing_image_key chat_id=${message.chat_id}`
      )
      return { sourceType: 'image', text: '收到图片但处理失败：缺少图片资源标识。' }
    }

    try {
      const resource = await this.client.im.v1.messageResource.get({
        params: { type: 'image' },
        path: {
          file_key: image.imageKey,
          message_id: message.message_id,
        },
      })
      const imageBuffer = await readableToBuffer(resource.getReadableStream())
      const imagePath = await this.saveFeishuImageBuffer(imageBuffer, '.png', message.chat_id)
      return {
        imagePath,
        sourceType: 'image',
        text: '收到一张来自飞书的图片。请用 Read 工具打开上方 image= 路径查看。',
      }
    } catch (error) {
      this.logger.warn(
        `feishu inbound image failed reason=image_download_failed chat_id=${message.chat_id} image_key=${image.imageKey}`,
        stringifyFeishuError(error)
      )
      return { sourceType: 'image', text: '收到图片但处理失败：无法下载飞书图片资源。' }
    }
  }

  private async extractInboundImageFile(
    event: MessageReceiveEvent
  ): Promise<{ imagePath?: string; sourceType: 'image'; text: string } | null> {
    const { message } = event
    let file: ReturnType<typeof parseFileContent> | null = null
    try {
      file = parseFileContent(message.content)
    } catch (error) {
      this.logger.warn(
        `feishu inbound file failed reason=invalid_file_content chat_id=${message.chat_id}`,
        error
      )
      return { sourceType: 'image', text: '收到图片但处理失败：文件消息格式无法解析。' }
    }
    if (!file) {
      this.logger.info(`feishu inbound dropped reason=missing_file_key chat_id=${message.chat_id}`)
      return null
    }

    const ext = extname(file.fileName).toLowerCase()
    if (!FEISHU_IMAGE_FILE_EXTS.has(ext)) {
      this.logger.info(
        `feishu inbound dropped reason=unsupported_file_type chat_id=${message.chat_id} file_name=${JSON.stringify(file.fileName)}`
      )
      return null
    }

    try {
      const resource = await this.client.im.v1.messageResource.get({
        params: { type: 'file' },
        path: {
          file_key: file.fileKey,
          message_id: message.message_id,
        },
      })
      const imageBuffer = await readableToBuffer(resource.getReadableStream())
      const imagePath = await this.saveFeishuImageBuffer(imageBuffer, ext, message.chat_id)
      return {
        imagePath,
        sourceType: 'image',
        text: `收到一张来自飞书文件附件的图片：${file.fileName}。请用 Read 工具打开上方 image= 路径查看。`,
      }
    } catch (error) {
      this.logger.warn(
        `feishu inbound file failed reason=file_download_failed chat_id=${message.chat_id} file_key=${file.fileKey}`,
        stringifyFeishuError(error)
      )
      return { sourceType: 'image', text: '收到图片但处理失败：无法下载飞书文件资源。' }
    }
  }

  private async saveFeishuImageBuffer(buffer: Buffer, ext: string, chatId: string) {
    if (buffer.length > FEISHU_IMAGE_MAX_BYTES) {
      this.logger.warn(
        `feishu inbound image failed reason=image_too_large chat_id=${chatId} size=${buffer.length}`
      )
      throw new Error('Feishu image exceeds 20MB limit')
    }
    const uploadsDir = getUploadsDir()
    await mkdir(uploadsDir, { recursive: true })
    const imagePath = join(uploadsDir, `${randomUUID()}${ext}`)
    await writeFile(imagePath, buffer)
    return imagePath
  }

  private async extractAudioTranscript(event: MessageReceiveEvent): Promise<string | null> {
    const { message } = event
    let audio: ReturnType<typeof parseAudioContent> | null = null
    try {
      audio = parseAudioContent(message.content)
    } catch (error) {
      this.logger.warn(
        `feishu inbound dropped reason=invalid_audio_content chat_id=${message.chat_id}`,
        error
      )
      return null
    }
    if (!audio) {
      this.logger.info(`feishu inbound dropped reason=missing_audio chat_id=${message.chat_id}`)
      return null
    }

    try {
      const resource = await this.client.im.v1.messageResource.get({
        params: { type: 'audio' },
        path: {
          file_key: audio.fileKey,
          message_id: message.message_id,
        },
      })
      const audioBuffer = await readableToBuffer(resource.getReadableStream())
      const localTranscript = await this.extractLocalAudioTranscript(audioBuffer, {
        chatId: message.chat_id,
        fileKey: audio.fileKey,
      })
      if (localTranscript) return localTranscript

      const response = await this.client.speech_to_text.v1.speech.fileRecognize({
        data: {
          config: {
            engine_type: FEISHU_AUDIO_RECOGNIZE_ENGINE,
            file_id: audio.fileKey,
            format: FEISHU_AUDIO_RECOGNIZE_FORMAT,
          },
          speech: {
            speech: audioBuffer.toString('base64'),
          },
        },
      })
      const transcript = response.data?.recognition_text?.trim()
      if (!transcript) {
        this.logger.info(
          `feishu inbound dropped reason=empty_audio_transcript chat_id=${message.chat_id} file_key=${audio.fileKey}`
        )
        return null
      }
      return transcript
    } catch (error) {
      this.logger.warn(
        `feishu inbound dropped reason=audio_transcribe_failed chat_id=${message.chat_id} file_key=${audio.fileKey}`,
        stringifyFeishuError(error)
      )
      return null
    }
  }

  private async extractLocalAudioTranscript(
    audioBuffer: Buffer,
    input: { chatId: string; fileKey: string }
  ): Promise<string | null> {
    const tempDir = await mkdtemp(join(tmpdir(), 'hive-feishu-audio-'))
    const audioPath = join(tempDir, `${input.fileKey}.opus`)
    try {
      await writeFile(audioPath, audioBuffer)
      const result = await this.localSttProvider.transcribeAudioFile(audioPath)
      if (!result) return null
      const transcript = result?.text.trim()
      if (!transcript) return null
      this.logger.info(
        `feishu audio transcribed locally chat_id=${input.chatId} file_key=${input.fileKey} provider=${result.provider}`
      )
      return transcript
    } catch (error) {
      this.logger.warn(
        `feishu local STT failed chat_id=${input.chatId} file_key=${input.fileKey}`,
        stringifyFeishuError(error)
      )
      return null
    } finally {
      await rm(tempDir, { force: true, recursive: true })
    }
  }

  private async handleCardAction(event: FeishuCardActionTriggerEvent) {
    const action = parseApprovalCardAction(event.action?.value)
    const operator = getCardActionOperator(event)
    if (!action || !operator) {
      return { toast: { content: '审批参数无效', type: 'warning' } }
    }

    const resolved = this.store.approvalLedger.resolve(action.approvalId, action.decision, operator)
    if (!resolved) {
      return { toast: { content: '审批已处理 / 已过期', type: 'warning' } }
    }

    this.logger.info(
      `feishu approval resolved approval_id=${resolved.approvalId} decision=${resolved.decision} operator=${operator}`
    )
    const messageId =
      resolved.messageId || event.context?.open_message_id || event.open_message_id || ''
    void this.finishResolvedApproval(resolved, messageId).catch((error) => {
      this.logger.error(
        `feishu approval post-resolve failed approval_id=${resolved.approvalId}`,
        error
      )
    })
    return { toast: { content: '审批已处理', type: 'success' } }
  }

  private async finishResolvedApproval(resolved: ResolvedApproval, messageId: string) {
    await this.updateApprovalCard({
      action: resolved.action,
      approvalId: resolved.approvalId,
      decision: resolved.decision,
      messageId,
      operator: resolved.operator,
      resolvedAt: resolved.resolvedAt,
    })
    this.injectApprovalDecision(resolved)
  }

  private injectApprovalDecision(resolved: ResolvedApproval) {
    const keyword = resolved.decision === 'allow' ? 'ALLOWED' : 'DENIED'
    const message = [
      `[Hive 系统消息：approval_id=${resolved.approvalId} ${keyword} by feishu user_id=${resolved.operator} at ${formatTime(resolved.resolvedAt)}]`,
      `action: ${resolved.action}`,
    ].join('\n')
    this.store.recordUserInput(resolved.workspaceId, resolved.orchAgentId, message)
    this.logger.info(
      `feishu approval injected to orch agent_id=${resolved.orchAgentId} approval_id=${resolved.approvalId}`
    )
  }

  private startCleanupTimer() {
    if (this.cleanupInterval) return
    this.cleanupInterval = setInterval(() => {
      const removed = this.store.approvalLedger.cleanup(APPROVAL_LEDGER_TTL_MS)
      if (removed > 0) {
        this.logger.info(`feishu approval cleanup removed=${removed}`)
      }
    }, APPROVAL_LEDGER_CLEANUP_INTERVAL_MS)
    this.cleanupInterval.unref?.()
  }
}

const formatTime = (timeMs: number) =>
  new Date(timeMs).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
