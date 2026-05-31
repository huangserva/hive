import type { ChatMessage } from '../api/client'

export interface OptimisticChatMessage {
  clientNonce: string
  content_json: string
  created_at: number
  id: string
  message_type: 'user_text'
}

const parseMessageContent = (json: string) => {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>
    const text = parsed.text
    return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : json.trim()
  } catch {
    return json.trim()
  }
}

const stableMessageKey = (
  message: Pick<ChatMessage | OptimisticChatMessage, 'content_json' | 'message_type'>
) => `${message.message_type}:${parseMessageContent(message.content_json)}`

const compareMessageOrder = (
  left: Pick<ChatMessage, 'created_at' | 'id'>,
  right: Pick<ChatMessage, 'created_at' | 'id'>
) => left.created_at - right.created_at || left.id.localeCompare(right.id)

export const filterPendingOptimisticMessages = <T extends OptimisticChatMessage>({
  chatMessages,
  optimisticMessages,
}: {
  chatMessages: Array<Pick<ChatMessage, 'content_json' | 'created_at' | 'id' | 'message_type'>>
  optimisticMessages: T[]
}): T[] => {
  const serverIds = new Set(chatMessages.map((message) => message.id))
  const optimisticByKey = new Map<string, T[]>()
  for (const message of optimisticMessages) {
    const key = stableMessageKey(message)
    const bucket = optimisticByKey.get(key)
    if (bucket) {
      bucket.push(message)
    } else {
      optimisticByKey.set(key, [message])
    }
  }

  const matchedOptimisticIds = new Set<string>()
  const sortedServerMessages = [...chatMessages].sort(compareMessageOrder)
  for (const serverMessage of sortedServerMessages) {
    const bucket = optimisticByKey.get(stableMessageKey(serverMessage))
    const matched = bucket?.shift()
    if (matched) matchedOptimisticIds.add(matched.id)
  }

  return optimisticMessages.filter(
    (message) => !serverIds.has(message.id) && !matchedOptimisticIds.has(message.id)
  )
}
