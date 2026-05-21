import type { EventHandles } from '@larksuiteoapi/node-sdk'
import * as lark from '@larksuiteoapi/node-sdk'

import type {
  FeishuApprovalDecision,
  FeishuApprovalRisk,
  ResolvedApproval,
} from './feishu-approval-ledger.js'
import type { FeishuCredentials } from './feishu-credentials.js'
import { type FeishuInboundChatEvent, handleFeishuInbound } from './feishu-inbound-handler.js'
import { resolveRoute } from './feishu-route-resolver.js'
import {
  chunkFeishuText,
  getSenderUserId,
  parseTextContent,
  stripLeadingMentions,
} from './feishu-transport-utils.js'
import type { HiveLogger } from './logger.js'
import type { RuntimeStore } from './runtime-store.js'

type MessageReceiveEvent = Parameters<NonNullable<EventHandles['im.message.receive_v1']>>[0]
type CardActionTriggerEvent = lark.RawCardActionEvent
export type FeishuTransportState = 'connected' | 'disconnected' | 'error'

export interface FeishuOutboundTransport {
  getLastChatForAgent(agentId: string): string | null
  getStatus(): { appId: string; reconnectCount: number; state: FeishuTransportState }
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
  onInboundChat?: (event: FeishuInboundChatEvent) => Promise<void> | void
  store: RuntimeStore
}

const MAX_RECONNECTS_BEFORE_ERROR = 10
const APPROVAL_LEDGER_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const APPROVAL_LEDGER_TTL_MS = 60 * 60 * 1000

export class FeishuTransport implements FeishuOutboundTransport {
  private readonly credentials: FeishuCredentials
  private readonly logger: HiveLogger
  private readonly onInboundChat:
    | ((event: FeishuInboundChatEvent) => Promise<void> | void)
    | undefined
  private readonly store: RuntimeStore
  private readonly client: lark.Client
  private readonly lastChatByAgent = new Map<string, string>()
  private reconnectCount = 0
  private state: FeishuTransportState = 'disconnected'
  private cleanupInterval: ReturnType<typeof setInterval> | null = null
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
      'card.action.trigger': async (event: CardActionTriggerEvent) => {
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
    const senderUserId = getSenderUserId(event.sender)
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
    this.lastChatByAgent.set(route.orchestratorAgentId, chatId)

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

  private async handleCardAction(event: CardActionTriggerEvent) {
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

const approvalRiskLabel = (risk: FeishuApprovalRisk) =>
  risk === 'medium' ? '中风险动作' : '高风险动作'

const approvalRiskTemplate = (risk: FeishuApprovalRisk) => (risk === 'medium' ? 'orange' : 'red')

const buildApprovalCard = (input: SendApprovalCardInput) => ({
  config: { update_multi: true, wide_screen_mode: true },
  header: {
    template: approvalRiskTemplate(input.risk),
    title: { content: `🤖 Hive 审批请求 · ${approvalRiskLabel(input.risk)}`, tag: 'plain_text' },
  },
  elements: [
    {
      fields: [
        { is_short: false, text: { content: `**动作**\n${input.action}`, tag: 'lark_md' } },
        {
          is_short: true,
          text: { content: `**派给**\n${input.target || 'orchestrator 自己'}`, tag: 'lark_md' },
        },
        {
          is_short: true,
          text: { content: `**Workspace**\n${input.workspaceName}`, tag: 'lark_md' },
        },
      ],
      tag: 'div',
    },
    { tag: 'hr' },
    {
      actions: [
        {
          tag: 'button',
          text: { content: '✅ 允许', tag: 'plain_text' },
          type: 'primary',
          value: { approval_id: input.approvalId, decision: 'allow' },
        },
        {
          tag: 'button',
          text: { content: '❌ 拒绝', tag: 'plain_text' },
          type: 'danger',
          value: { approval_id: input.approvalId, decision: 'deny' },
        },
      ],
      tag: 'action',
    },
  ],
})

const buildResolvedApprovalCard = (input: UpdateApprovalCardInput) => ({
  config: { update_multi: true, wide_screen_mode: true },
  header: {
    template: input.decision === 'allow' ? 'green' : 'grey',
    title: {
      content: input.decision === 'allow' ? '✅ 已允许' : '❌ 已拒绝',
      tag: 'plain_text',
    },
  },
  elements: [
    {
      fields: [
        { is_short: false, text: { content: `**动作**\n${input.action}`, tag: 'lark_md' } },
        {
          is_short: false,
          text: {
            content: `**处理结果**\nby @${input.operator} at ${formatHourMinute(input.resolvedAt)}`,
            tag: 'lark_md',
          },
        },
      ],
      tag: 'div',
    },
  ],
})

const parseApprovalCardAction = (
  value: unknown
): { approvalId: string; decision: FeishuApprovalDecision } | null => {
  if (!value || typeof value !== 'object') return null
  const payload = value as { approval_id?: unknown; decision?: unknown }
  const { approval_id: approvalId, decision } = payload
  if (typeof approvalId !== 'string') return null
  if (decision !== 'allow' && decision !== 'deny') return null
  return { approvalId, decision }
}

const getCardActionOperator = (event: CardActionTriggerEvent) =>
  event.operator?.user_id ?? event.operator?.open_id ?? event.operator?.union_id ?? null

const formatHourMinute = (timeMs: number) =>
  new Date(timeMs).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

const formatTime = (timeMs: number) =>
  new Date(timeMs).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
