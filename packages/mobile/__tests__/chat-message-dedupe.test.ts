import { describe, expect, test } from 'vitest'

import { filterPendingOptimisticMessages } from '../src/lib/chat-message-dedupe'

const chatMessage = (overrides: { content_json: string; created_at: number; id: string }) => ({
  created_at: overrides.created_at,
  content_json: overrides.content_json,
  id: overrides.id,
  message_type: 'user_text' as const,
})

describe('filterPendingOptimisticMessages', () => {
  test('dedupes optimistic messages against later server echoes without relying on a 10 second window', () => {
    const content_json = JSON.stringify({ text: 'hello' })
    const optimistic = [
      {
        content_json,
        created_at: Date.parse('2026-05-31T10:00:00Z'),
        id: 'opt-1',
        message_type: 'user_text' as const,
      },
    ]

    expect(
      filterPendingOptimisticMessages({
        chatMessages: [
          chatMessage({
            content_json,
            created_at: Date.parse('2026-05-31T10:00:30Z'),
            id: 'srv-1',
          }),
        ],
        optimisticMessages: optimistic,
      })
    ).toEqual([])
  })
})
