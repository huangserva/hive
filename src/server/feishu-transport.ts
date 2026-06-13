import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
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
  sendMedia(input: SendMediaInput): Promise<SendMediaResult>
  sendMessage(chatId: string, text: string): Promise<void>
  updateApprovalCard(input: UpdateApprovalCardInput): Promise<void>
}

// M44: 出站媒体发送（CLI `team feishu reply --file <path>`）。
// 镜像现有 `team mobile-send-media`：CLI → routes-feishu → transport.sendMedia。
export interface SendMediaInput {
  caption?: string
  chatId: string
  filePath: string
}

export interface SendMediaResult {
  /** 'image' | 'media'（视频）| 'file'（其它）—— 与飞书 msg_type 对齐。 */
  category: 'file' | 'image' | 'media'
  fileName: string
  /** 视频/文件通过 file.create 拿到的 key；image 路径恒 null。 */
  fileKey: string | null
  /** image.create 拿到的 key；视频/文件路径恒 null。 */
  imageKey: string | null
  /** 是否同时跟了一条 caption text 消息。 */
  sentCaption: boolean
}

// 飞书 SDK API 限制：image.create 10MB、file.create 30MB。失败时抛清晰错误。
const FEISHU_IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024
const FEISHU_FILE_UPLOAD_MAX_BYTES = 30 * 1024 * 1024
// 出站扩展名映射（图片走 image.create；其余按扩展名映射到 file.create 的 file_type）。
const FEISHU_IMAGE_UPLOAD_EXTS = new Set([
  '.bmp',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.png',
  '.tiff',
  '.webp',
])
// 钟馗顺手 #1：仅 .mp4 走 file_type='mp4' + msg_type='media'。其它视频扩展（.mov/.mkv/.webm/.avi）
// 强行声称 file_type='mp4' 会让飞书后端按 mp4 容器解析非 mp4 字节流——拒上传或视频播放花屏。
// 故这些扩展走 msg_type='file' + file_type='stream'：飞书按通用文件处理，用户在飞书侧可下载播放。
const FEISHU_NATIVE_VIDEO_EXT = '.mp4'
// file.create 的 file_type 受 SDK 类型约束：'opus'|'mp4'|'pdf'|'doc'|'xls'|'ppt'|'stream'。
// 我们按扩展名映射常见情况；剩余统一 'stream'（飞书后端按内容嗅探或当二进制处理）。
const FEISHU_FILE_TYPE_BY_EXT: Record<string, 'doc' | 'mp4' | 'opus' | 'pdf' | 'ppt' | 'xls'> = {
  '.doc': 'doc',
  '.docx': 'doc',
  '.mp4': 'mp4',
  '.opus': 'opus',
  '.pdf': 'pdf',
  '.ppt': 'ppt',
  '.pptx': 'ppt',
  '.xls': 'xls',
  '.xlsx': 'xls',
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
  // 钟馗第二轮 B2：tsconfig 同时引 ES2022 + DOM lib 让 setInterval overload 解析到 DOM 的 number 版本，
  // ReturnType<typeof setInterval> 就成了 number 而非 NodeJS.Timeout，导致 .unref?.() 触发 TS2339。
  // 收紧到 NodeJS.Timeout（Node 运行时真实类型）即可拿回 unref。clearInterval 接受 NodeJS.Timeout，
  // 行为面不变。
  private cleanupInterval: NodeJS.Timeout | null = null
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

  // M44: 出站媒体（CLI `team feishu reply --file <path>` 走 routes-feishu→此）。
  // 按扩展名分流：图片走 image.create → msg_type='image'；视频走 file.create(file_type='mp4')
  // → msg_type='media'；其它文件走 file.create(file_type=映射) → msg_type='file'。
  // caption（text）若有，紧跟一条 text 消息发出（不内联到媒体卡片）。
  async sendMedia(input: SendMediaInput): Promise<SendMediaResult> {
    const { caption, chatId, filePath } = input
    if (!existsSync(filePath)) {
      throw new Error(`Source media file not found: ${filePath}`)
    }
    const stat = statSync(filePath)
    if (!stat.isFile()) {
      throw new Error(`Source path is not a regular file: ${filePath}`)
    }
    const fileName = basename(filePath)
    const ext = extname(fileName).toLowerCase()
    const buffer = await readFile(filePath)

    // 钟馗顺手 #3：0 字节文件直接本地拒（飞书 file.create / image.create 会 400 "不允许上传空文件"，
    // 本地预拒给出更清晰的错误而不是把 SDK 4xx 透回 CLI）。
    if (buffer.length === 0) {
      throw new Error(`Source media file is empty: ${filePath}`)
    }

    let category: 'file' | 'image' | 'media'
    let imageKey: string | null = null
    let fileKey: string | null = null

    if (FEISHU_IMAGE_UPLOAD_EXTS.has(ext)) {
      if (buffer.length > FEISHU_IMAGE_UPLOAD_MAX_BYTES) {
        throw new Error(
          `Feishu image upload exceeds 10MB limit: size=${buffer.length} path=${filePath}`
        )
      }
      const response = await this.client.im.v1.image.create({
        data: {
          image: buffer,
          image_type: 'message',
        },
      })
      const key = response?.image_key
      if (!key) {
        throw new Error('Feishu image.create response missing image_key')
      }
      imageKey = key
      await this.client.im.v1.message.create({
        data: {
          content: JSON.stringify({ image_key: key }),
          msg_type: 'image',
          receive_id: chatId,
        },
        params: { receive_id_type: 'chat_id' },
      })
      category = 'image'
    } else {
      if (buffer.length > FEISHU_FILE_UPLOAD_MAX_BYTES) {
        throw new Error(
          `Feishu file upload exceeds 30MB limit: size=${buffer.length} path=${filePath}`
        )
      }
      // 钟馗顺手 #1：仅 .mp4 真用 file_type='mp4' + msg_type='media' 走飞书原生视频卡；
      // 其它视频扩展（.mov/.mkv/.webm/.avi）按通用文件 file_type='stream' + msg_type='file' 发，
      // 避免伪装 mp4 容器导致后端 400 或视频播放花屏。
      const isNativeVideo = ext === FEISHU_NATIVE_VIDEO_EXT
      const fileType: 'doc' | 'mp4' | 'opus' | 'pdf' | 'ppt' | 'stream' | 'xls' = isNativeVideo
        ? 'mp4'
        : (FEISHU_FILE_TYPE_BY_EXT[ext] ?? 'stream')
      const response = await this.client.im.v1.file.create({
        data: {
          file: buffer,
          file_name: fileName,
          file_type: fileType,
        },
      })
      const key = response?.file_key
      if (!key) {
        throw new Error('Feishu file.create response missing file_key')
      }
      fileKey = key
      const msgType: 'file' | 'media' = isNativeVideo ? 'media' : 'file'
      await this.client.im.v1.message.create({
        data: {
          content: JSON.stringify({ file_key: key }),
          msg_type: msgType,
          receive_id: chatId,
        },
        params: { receive_id_type: 'chat_id' },
      })
      category = isNativeVideo ? 'media' : 'file'
    }

    const trimmedCaption = caption?.trim()
    let sentCaption = false
    if (trimmedCaption) {
      await this.sendMessage(chatId, trimmedCaption)
      sentCaption = true
    }
    this.logger.info(
      `feishu outbound media sent chat_id=${chatId} file_name=${fileName} category=${category} size=${buffer.length} caption=${sentCaption ? 'yes' : 'no'}`
    )
    return { category, fileKey, fileName, imageKey, sentCaption }
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
      ...(inboundText.mediaPath ? { mediaPath: inboundText.mediaPath } : {}),
      ...(inboundText.mediaFileName ? { mediaFileName: inboundText.mediaFileName } : {}),
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
      // M44 后：image / file / media / audio 已在 extractInboundText 上游分流，
      // 这里 fallthrough 的剩余 message_type 是 sticker / system / interactive 等仍未支持的载荷。
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

  private async extractInboundText(event: MessageReceiveEvent): Promise<{
    imagePath?: string
    mediaPath?: string
    mediaFileName?: string
    sourceType: 'file' | 'image' | 'text' | 'video' | 'voice'
    text: string
  } | null> {
    const { message } = event
    if (message.message_type === 'audio') {
      const transcript = await this.extractAudioTranscript(event)
      return transcript ? { sourceType: 'voice', text: transcript } : null
    }
    if (message.message_type === 'image') {
      return this.extractInboundImage(event)
    }
    // M44: msg_type 'media' = 飞书原生视频消息（含 file_key）。
    if (message.message_type === 'media') {
      return this.extractInboundVideo(event)
    }
    if (message.message_type === 'file') {
      // M44: file 消息按扩展名再分流：图片扩展走 extractInboundImageFile（保留旧逻辑），
      // 视频扩展 / 其它扩展走 extractInboundFile（新增）。
      const file = (() => {
        try {
          return parseFileContent(message.content)
        } catch {
          return null
        }
      })()
      if (file) {
        const ext = extname(file.fileName).toLowerCase()
        if (FEISHU_IMAGE_FILE_EXTS.has(ext)) return this.extractInboundImageFile(event)
        return this.extractInboundFile(event)
      }
      return this.extractInboundImageFile(event)
    }
    const text = this.extractText(event)
    return text === null ? null : { sourceType: 'text', text }
  }

  // M44: 入站视频（msg_type='media'）—— 解析 file_key 后下载，写 uploads 目录，surface 路径给 orch。
  private async extractInboundVideo(event: MessageReceiveEvent): Promise<{
    mediaPath?: string
    mediaFileName?: string
    sourceType: 'video'
    text: string
  } | null> {
    const { message } = event
    let file: ReturnType<typeof parseFileContent> | null = null
    try {
      file = parseFileContent(message.content)
    } catch (error) {
      this.logger.warn(
        `feishu inbound video failed reason=invalid_media_content chat_id=${message.chat_id}`,
        error
      )
      return { sourceType: 'video', text: '收到视频但处理失败：媒体消息格式无法解析。' }
    }
    if (!file) {
      this.logger.warn(
        `feishu inbound video failed reason=missing_file_key chat_id=${message.chat_id}`
      )
      return { sourceType: 'video', text: '收到视频但处理失败：缺少视频资源标识。' }
    }
    try {
      const resource = await this.client.im.v1.messageResource.get({
        params: { type: 'file' },
        path: {
          file_key: file.fileKey,
          message_id: message.message_id,
        },
      })
      const buffer = await readableToBuffer(resource.getReadableStream())
      const ext = extname(file.fileName).toLowerCase() || '.mp4'
      const mediaPath = await this.saveFeishuMediaBuffer(buffer, ext, message.chat_id)
      return {
        mediaPath,
        mediaFileName: file.fileName,
        sourceType: 'video',
        text: `收到一条来自飞书的视频：${file.fileName}。本地路径见上方 media= 字段，需要查看时按需读取（视频文件较大，建议必要时再处理）。`,
      }
    } catch (error) {
      this.logger.warn(
        `feishu inbound video failed reason=video_download_failed chat_id=${message.chat_id} file_key=${file.fileKey}`,
        stringifyFeishuError(error)
      )
      return { sourceType: 'video', text: '收到视频但处理失败：无法下载飞书视频资源。' }
    }
  }

  // M44: 入站非图片 file 消息（视频文档当文件发的、PDF 等）—— surface 给 orch 但不强制 Read。
  private async extractInboundFile(event: MessageReceiveEvent): Promise<{
    mediaPath?: string
    mediaFileName?: string
    sourceType: 'file'
    text: string
  } | null> {
    const { message } = event
    let file: ReturnType<typeof parseFileContent> | null = null
    try {
      file = parseFileContent(message.content)
    } catch (error) {
      this.logger.warn(
        `feishu inbound file failed reason=invalid_file_content chat_id=${message.chat_id}`,
        error
      )
      return { sourceType: 'file', text: '收到文件但处理失败：文件消息格式无法解析。' }
    }
    if (!file) {
      this.logger.info(`feishu inbound dropped reason=missing_file_key chat_id=${message.chat_id}`)
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
      const buffer = await readableToBuffer(resource.getReadableStream())
      const ext = extname(file.fileName).toLowerCase() || '.bin'
      const mediaPath = await this.saveFeishuMediaBuffer(buffer, ext, message.chat_id)
      return {
        mediaPath,
        mediaFileName: file.fileName,
        sourceType: 'file',
        text: `收到一份来自飞书的文件：${file.fileName}。本地路径见上方 media= 字段，按需读取。`,
      }
    } catch (error) {
      this.logger.warn(
        `feishu inbound file failed reason=file_download_failed chat_id=${message.chat_id} file_key=${file.fileKey}`,
        stringifyFeishuError(error)
      )
      return { sourceType: 'file', text: '收到文件但处理失败：无法下载飞书文件资源。' }
    }
  }

  // M44: 入站视频/文件存盘，与 mobile/team-send-media 同一 uploads 目录约定。
  private async saveFeishuMediaBuffer(buffer: Buffer, ext: string, chatId: string) {
    // 钟馗顺手 #2：入站限放宽到 100MB（手机录屏常 60-80MB；飞书 messageResource 实际放行可达 100MB 内）。
    // 出站 file.create 30MB 上限保留（SDK 接口限制），与入站独立。
    const FEISHU_INBOUND_MEDIA_MAX_BYTES = 100 * 1024 * 1024
    if (buffer.length > FEISHU_INBOUND_MEDIA_MAX_BYTES) {
      this.logger.warn(
        `feishu inbound media failed reason=media_too_large chat_id=${chatId} size=${buffer.length}`
      )
      throw new Error('Feishu inbound media exceeds 100MB limit')
    }
    const uploadsDir = getUploadsDir()
    await mkdir(uploadsDir, { recursive: true })
    const mediaPath = join(uploadsDir, `${randomUUID()}${ext}`)
    await writeFile(mediaPath, buffer)
    return mediaPath
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
    // setInterval overload 在同时引 ES2022 + DOM lib 时返回 number，必须显式断言到 NodeJS.Timeout
    // 才能拿回 .unref()（行为面不变；Node 运行时本就返 Timeout）。
    this.cleanupInterval = setInterval(() => {
      const removed = this.store.approvalLedger.cleanup(APPROVAL_LEDGER_TTL_MS)
      if (removed > 0) {
        this.logger.info(`feishu approval cleanup removed=${removed}`)
      }
    }, APPROVAL_LEDGER_CLEANUP_INTERVAL_MS) as unknown as NodeJS.Timeout
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
