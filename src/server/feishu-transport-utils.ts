import type { EventHandles } from '@larksuiteoapi/node-sdk'

type MessageReceiveEvent = Parameters<NonNullable<EventHandles['im.message.receive_v1']>>[0]

export type FeishuMessageSender = MessageReceiveEvent['sender']
export type FeishuMention = NonNullable<MessageReceiveEvent['message']['mentions']>[number]

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
