import type { ChatMessage } from '../api/client'

export interface OptimisticChatMessage {
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

export const filterPendingOptimisticMessages = <T extends OptimisticChatMessage>({
  chatMessages,
  optimisticMessages,
}: {
  chatMessages: Array<Pick<ChatMessage, 'content_json' | 'created_at' | 'id' | 'message_type'>>
  optimisticMessages: T[]
}): T[] => {
  const serverIds = new Set(chatMessages.map((message) => message.id))
  const persistedUserText = new Set(
    chatMessages
      .filter((message) => message.message_type === 'user_text')
      .map((message) => stableMessageKey(message))
  )

  return optimisticMessages.filter(
    (message) => !serverIds.has(message.id) && !persistedUserText.has(stableMessageKey(message))
  )
}
