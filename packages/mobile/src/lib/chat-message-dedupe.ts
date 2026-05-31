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

  // 每个 key 一桶 optimistic，桶内按创建时间升序。
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
  for (const bucket of optimisticByKey.values()) bucket.sort(compareMessageOrder)

  // 一对一消费，且关键约束：一条 server echo 只能消费「在它之前创建」的 optimistic。
  // 这样历史里早就存在的同文案消息（created_at 早于本次 optimistic）绝不会把刚发的连发
  // 消息提前吃掉——合法连发得以保留，只被它创建之后到达的那条新鲜 echo 消费（M28 #23 HIGH 回归）。
  const matchedOptimisticIds = new Set<string>()
  const sortedServerMessages = [...chatMessages].sort(compareMessageOrder)
  for (const serverMessage of sortedServerMessages) {
    const bucket = optimisticByKey.get(stableMessageKey(serverMessage))
    if (!bucket || bucket.length === 0) continue
    const candidate = bucket[0]
    // 桶按创建时间升序：若最早的 optimistic 都晚于这条 server 消息，则它（及其后所有）都不是
    // 这条 server 消息的回声 —— 跳过，留给后续更新的 echo。
    if (candidate && candidate.created_at <= serverMessage.created_at) {
      bucket.shift()
      matchedOptimisticIds.add(candidate.id)
    }
  }

  return optimisticMessages.filter(
    (message) => !serverIds.has(message.id) && !matchedOptimisticIds.has(message.id)
  )
}
