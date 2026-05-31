import { describe, expect, test } from 'vitest'

import { filterPendingOptimisticMessages } from '../src/lib/chat-message-dedupe'

const chatMessage = (overrides: { content_json: string; created_at: number; id: string }) => ({
  created_at: overrides.created_at,
  content_json: overrides.content_json,
  id: overrides.id,
  message_type: 'user_text' as const,
})

const optimisticMessage = (overrides: {
  clientNonce: string
  content_json: string
  created_at: number
  id: string
}) => ({
  clientNonce: overrides.clientNonce,
  content_json: overrides.content_json,
  created_at: overrides.created_at,
  id: overrides.id,
  message_type: 'user_text' as const,
})

describe('filterPendingOptimisticMessages', () => {
  test('removes only the optimistic shadow for one server echo even if the echo arrives much later', () => {
    const content_json = JSON.stringify({ text: 'hello' })
    const optimistic = [
      optimisticMessage({
        clientNonce: 'nonce-1',
        content_json,
        created_at: Date.parse('2026-05-31T10:00:00Z'),
        id: 'opt-1',
      }),
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

  test('keeps a real second send with the same content when only one echo has arrived', () => {
    const content_json = JSON.stringify({ text: 'repeat me' })
    const optimistic = [
      optimisticMessage({
        clientNonce: 'nonce-1',
        content_json,
        created_at: Date.parse('2026-05-31T10:00:00Z'),
        id: 'opt-1',
      }),
      optimisticMessage({
        clientNonce: 'nonce-2',
        content_json,
        created_at: Date.parse('2026-05-31T10:01:00Z'),
        id: 'opt-2',
      }),
    ]

    const pending = filterPendingOptimisticMessages({
      chatMessages: [
        chatMessage({
          content_json,
          created_at: Date.parse('2026-05-31T10:00:30Z'),
          id: 'srv-1',
        }),
      ],
      optimisticMessages: optimistic,
    })

    expect(pending).toHaveLength(1)
    expect(pending[0]?.id).toBe('opt-2')
  })

  test('keeps same-content messages distinct until each has a matching echo', () => {
    const content_json = JSON.stringify({ text: 'same text twice' })
    const optimistic = [
      optimisticMessage({
        clientNonce: 'nonce-1',
        content_json,
        created_at: Date.parse('2026-05-31T10:00:00Z'),
        id: 'opt-1',
      }),
      optimisticMessage({
        clientNonce: 'nonce-2',
        content_json,
        created_at: Date.parse('2026-05-31T10:01:00Z'),
        id: 'opt-2',
      }),
    ]

    expect(
      filterPendingOptimisticMessages({
        chatMessages: [
          chatMessage({
            content_json,
            created_at: Date.parse('2026-05-31T10:00:30Z'),
            id: 'srv-1',
          }),
          chatMessage({
            content_json,
            created_at: Date.parse('2026-05-31T10:01:30Z'),
            id: 'srv-2',
          }),
        ],
        optimisticMessages: optimistic,
      })
    ).toEqual([])
  })
})
