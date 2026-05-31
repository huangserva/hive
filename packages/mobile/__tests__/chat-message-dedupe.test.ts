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

  test('regression #23: a pre-existing history message must NOT consume a newer same-content send', () => {
    const content_json = JSON.stringify({ text: 'gm' })
    // 历史里早就有一条同文案（10:00:00）。
    const history = chatMessage({
      content_json,
      created_at: Date.parse('2026-05-31T10:00:00Z'),
      id: 'srv-old',
    })
    // user 之后又连发同一句（optimistic 创建于 10:05:00），它的 echo 还没到。
    const optimistic = [
      optimisticMessage({
        clientNonce: 'nonce-new',
        content_json,
        created_at: Date.parse('2026-05-31T10:05:00Z'),
        id: 'opt-new',
      }),
    ]

    const pending = filterPendingOptimisticMessages({
      chatMessages: [history],
      optimisticMessages: optimistic,
    })

    // 旧历史早于新 optimistic → 不得消费它 → 新发的消息必须保留（不再被误删）。
    expect(pending).toHaveLength(1)
    expect(pending[0]?.id).toBe('opt-new')
  })

  test('regression #23: the fresh echo (created after the send) does consume it; stale history still does not', () => {
    const content_json = JSON.stringify({ text: 'gm' })
    const pending = filterPendingOptimisticMessages({
      chatMessages: [
        chatMessage({
          content_json,
          created_at: Date.parse('2026-05-31T10:00:00Z'),
          id: 'srv-old',
        }),
        chatMessage({
          content_json,
          created_at: Date.parse('2026-05-31T10:05:20Z'),
          id: 'srv-echo',
        }),
      ],
      optimisticMessages: [
        optimisticMessage({
          clientNonce: 'nonce-new',
          content_json,
          created_at: Date.parse('2026-05-31T10:05:00Z'),
          id: 'opt-new',
        }),
      ],
    })

    // 旧历史(10:00)跳过，新鲜 echo(10:05:20 ≥ 10:05:00)消费 → optimistic 清掉。
    expect(pending).toEqual([])
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
