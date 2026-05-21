import type { EventHandles, RawCardActionEvent } from '@larksuiteoapi/node-sdk'

import type { FeishuApprovalDecision, FeishuApprovalRisk } from './feishu-approval-ledger.js'

type MessageReceiveEvent = Parameters<NonNullable<EventHandles['im.message.receive_v1']>>[0]

export type FeishuCardActionTriggerEvent = RawCardActionEvent
export type FeishuMessageSender = MessageReceiveEvent['sender']
export type FeishuMention = NonNullable<MessageReceiveEvent['message']['mentions']>[number]

export interface ApprovalCardInput {
  action: string
  approvalId: string
  risk: FeishuApprovalRisk
  target: string | null
  workspaceName: string
}

export interface ResolvedApprovalCardInput {
  action: string
  decision: FeishuApprovalDecision
  operator: string
  resolvedAt: number
}

export interface ParsedApprovalCardAction {
  approvalId: string
  decision: FeishuApprovalDecision
}

interface TextContent {
  text?: unknown
}

const UNKNOWN_SENDER = 'unknown'
const FEISHU_TEXT_LIMIT_BYTES = 30 * 1024
const FEISHU_TEXT_CHUNK_BYTES = 25 * 1024

export const getSenderUserId = (sender: FeishuMessageSender) =>
  sender.sender_id?.user_id ??
  sender.sender_id?.open_id ??
  sender.sender_id?.union_id ??
  UNKNOWN_SENDER

export const parseTextContent = (content: string) => {
  const parsed = JSON.parse(content) as TextContent
  return typeof parsed.text === 'string' ? parsed.text : null
}

export const stripLeadingMentions = (text: string, mentions: readonly FeishuMention[]) => {
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

const splitTextForPrefixedChunks = (text: string, totalChunks: number) => {
  const chunks: string[] = []
  let current = ''
  let currentBytes = 0

  for (const char of text) {
    const chunkIndex = chunks.length + 1
    const prefixBytes = Buffer.byteLength(`(${chunkIndex}/${totalChunks}) `, 'utf8')
    const maxBytes = FEISHU_TEXT_CHUNK_BYTES - prefixBytes
    const charBytes = Buffer.byteLength(char, 'utf8')

    if (current && currentBytes + charBytes > maxBytes) {
      chunks.push(current)
      current = ''
      currentBytes = 0
    }
    current += char
    currentBytes += charBytes
  }

  if (current || text.length === 0) chunks.push(current)
  return chunks
}

export const chunkFeishuText = (text: string): string[] => {
  if (Buffer.byteLength(text, 'utf8') <= FEISHU_TEXT_LIMIT_BYTES) {
    return [text]
  }

  let totalChunks = Math.ceil(Buffer.byteLength(text, 'utf8') / FEISHU_TEXT_CHUNK_BYTES)

  for (;;) {
    const chunks = splitTextForPrefixedChunks(text, totalChunks)
    if (chunks.length === totalChunks) {
      return chunks.map((chunk, index) => `(${index + 1}/${chunks.length}) ${chunk}`)
    }
    totalChunks = chunks.length
  }
}

const approvalRiskLabel = (risk: FeishuApprovalRisk) =>
  risk === 'medium' ? '中风险动作' : '高风险动作'

const approvalRiskTemplate = (risk: FeishuApprovalRisk) => (risk === 'medium' ? 'orange' : 'red')

export const buildApprovalCard = (input: ApprovalCardInput) => ({
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

export const buildResolvedApprovalCard = (input: ResolvedApprovalCardInput) => ({
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

export const parseApprovalCardAction = (value: unknown): ParsedApprovalCardAction | null => {
  if (!value || typeof value !== 'object') return null
  const payload = value as { approval_id?: unknown; decision?: unknown }
  const { approval_id: approvalId, decision } = payload
  if (typeof approvalId !== 'string') return null
  if (decision !== 'allow' && decision !== 'deny') return null
  return { approvalId, decision }
}

export const getCardActionOperator = (event: FeishuCardActionTriggerEvent) =>
  event.operator?.user_id ?? event.operator?.open_id ?? event.operator?.union_id ?? null

const formatHourMinute = (timeMs: number) =>
  new Date(timeMs).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
