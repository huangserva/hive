import type { EventHandles } from '@larksuiteoapi/node-sdk'

type MessageReceiveEvent = Parameters<NonNullable<EventHandles['im.message.receive_v1']>>[0]

export type FeishuMessageSender = MessageReceiveEvent['sender']
export type FeishuMention = NonNullable<MessageReceiveEvent['message']['mentions']>[number]

interface TextContent {
  text?: unknown
}

const UNKNOWN_SENDER = 'unknown'

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
