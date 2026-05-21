import type { EventHandles } from '@larksuiteoapi/node-sdk'
import * as lark from '@larksuiteoapi/node-sdk'

import type { FeishuCredentials } from './feishu-credentials.js'
import { type FeishuInboundChatEvent, handleFeishuInbound } from './feishu-inbound-handler.js'
import { resolveRoute } from './feishu-route-resolver.js'
import type { HiveLogger } from './logger.js'
import type { RuntimeStore } from './runtime-store.js'

type MessageReceiveEvent = Parameters<NonNullable<EventHandles['im.message.receive_v1']>>[0]

interface FeishuTransportOptions {
  credentials: FeishuCredentials
  logger: HiveLogger
  onInboundChat?: (event: FeishuInboundChatEvent) => Promise<void> | void
  store: RuntimeStore
}

interface TextContent {
  text?: unknown
}

const UNKNOWN_SENDER = 'unknown'
const MAX_RECONNECTS_BEFORE_ERROR = 10

const getSenderUserId = (event: MessageReceiveEvent) =>
  event.sender.sender_id?.user_id ??
  event.sender.sender_id?.open_id ??
  event.sender.sender_id?.union_id ??
  UNKNOWN_SENDER

const parseTextContent = (content: string) => {
  const parsed = JSON.parse(content) as TextContent
  return typeof parsed.text === 'string' ? parsed.text : null
}

const stripLeadingMentions = (
  text: string,
  mentions: NonNullable<MessageReceiveEvent['message']['mentions']>
) => {
  let remaining = text.trimStart()
  remaining = remaining.replace(/^(?:<at\s+[^>]*>.*?<\/at>\s*)+/i, '').trimStart()

  let stripped = true
  while (stripped) {
    stripped = false
    for (const mention of mentions) {
      const candidates = [mention.key, `@${mention.name}`, mention.name].filter(Boolean)
      const candidate = candidates.find((value) => remaining.startsWith(value))
      if (candidate) {
        remaining = remaining.slice(candidate.length).trimStart()
        stripped = true
        break
      }
    }
  }

  return remaining
}

export class FeishuTransport {
  private readonly credentials: FeishuCredentials
  private readonly logger: HiveLogger
  private readonly onInboundChat:
    | ((event: FeishuInboundChatEvent) => Promise<void> | void)
    | undefined
  private readonly store: RuntimeStore
  private readonly client: lark.Client
  private reconnectCount = 0
  private wsClient: lark.WSClient | null = null

  constructor({ credentials, logger, onInboundChat, store }: FeishuTransportOptions) {
    this.credentials = credentials
    this.logger = logger
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
    })

    this.wsClient = new lark.WSClient({
      appId: this.credentials.appId,
      appSecret: this.credentials.appSecret,
      domain: lark.Domain.Feishu,
      handshakeTimeoutMs: 10_000,
      loggerLevel: lark.LoggerLevel.error,
      onError: (error) => {
        this.logger.error('feishu WSClient error', error)
      },
      onReady: () => {
        this.reconnectCount = 0
        this.logger.info('feishu WSClient connected')
      },
      onReconnected: () => {
        this.reconnectCount = 0
        this.logger.info('feishu WSClient connected')
      },
      onReconnecting: () => {
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

    await this.wsClient.start({ eventDispatcher })
  }

  async stop(): Promise<void> {
    this.wsClient?.close()
    this.wsClient = null
  }

  private async handleMessageReceive(event: MessageReceiveEvent): Promise<void> {
    const chatId = event.message.chat_id
    const senderUserId = getSenderUserId(event)
    this.logger.info(`feishu inbound message chat_id=${chatId} sender=${senderUserId}`)

    const text = this.extractText(event)
    if (text === null) return

    const inboundEvent: FeishuInboundChatEvent = {
      chatId,
      senderName: senderUserId,
      text,
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

    await handleFeishuInbound({
      agentRuntime: this.store,
      event: inboundEvent,
      logger: this.logger,
      replyText: (replyChatId, textToSend) => this.replyText(replyChatId, textToSend),
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

  private async replyText(chatId: string, text: string): Promise<void> {
    await this.client.im.v1.message.create({
      data: {
        content: JSON.stringify({ text }),
        msg_type: 'text',
        receive_id: chatId,
      },
      params: { receive_id_type: 'chat_id' },
    })
  }
}
