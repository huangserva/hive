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
  workspaceId?: string
}) => ({
  clientNonce: overrides.clientNonce,
  content_json: overrides.content_json,
  created_at: overrides.created_at,
  id: overrides.id,
  message_type: 'user_text' as const,
  workspaceId: overrides.workspaceId,
})

describe('filterPendingOptimisticMessages', () => {
  test('keeps pending optimistic messages scoped to the selected workspace only', () => {
    const content_json = JSON.stringify({ text: 'workspace scoped' })
    const optimistic = [
      optimisticMessage({
        clientNonce: 'nonce-a',
        content_json,
        created_at: Date.parse('2026-06-02T10:00:00Z'),
        id: 'opt-a',
        workspaceId: 'workspace-a',
      }),
      optimisticMessage({
        clientNonce: 'nonce-b',
        content_json,
        created_at: Date.parse('2026-06-02T10:00:01Z'),
        id: 'opt-b',
        workspaceId: 'workspace-b',
      }),
    ]

    expect(
      filterPendingOptimisticMessages({
        chatMessages: [],
        currentWorkspaceId: 'workspace-b',
        optimisticMessages: optimistic,
      }).map((message) => message.id)
    ).toEqual(['opt-b'])

    expect(
      filterPendingOptimisticMessages({
        chatMessages: [],
        currentWorkspaceId: 'workspace-a',
        optimisticMessages: optimistic,
      }).map((message) => message.id)
    ).toEqual(['opt-a'])
  })

  test('hides other workspaces without deleting them, so switch-back and late-failure updates still work', () => {
    const content_json = JSON.stringify({ text: 'late failure' })
    let optimistic = [
      {
        ...optimisticMessage({
          clientNonce: 'nonce-a',
          content_json,
          created_at: Date.parse('2026-06-02T10:00:00Z'),
          id: 'opt-a',
          workspaceId: 'workspace-a',
        }),
        pending: true,
      },
    ]

    expect(
      filterPendingOptimisticMessages({
        chatMessages: [],
        currentWorkspaceId: 'workspace-b',
        optimisticMessages: optimistic,
      })
    ).toEqual([])

    expect(
      filterPendingOptimisticMessages({
        chatMessages: [],
        currentWorkspaceId: 'workspace-a',
        optimisticMessages: optimistic,
      }).map((message) => message.id)
    ).toEqual(['opt-a'])

    optimistic = optimistic.map((message) =>
      message.id === 'opt-a' ? { ...message, error: true, pending: false } : message
    )

    expect(
      filterPendingOptimisticMessages({
        chatMessages: [],
        currentWorkspaceId: 'workspace-a',
        optimisticMessages: optimistic,
      })
    ).toMatchObject([{ error: true, id: 'opt-a', pending: false }])
  })

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

  test('clock skew: server echo timestamped up to 3s BEFORE the optimistic is still consumed (phone clock ahead of Mac)', () => {
    // 手机时钟比 Mac 快 500ms → optimistic.created_at = t+500, server.created_at = t。
    // 原来严格 <= 判断失败 → 两份气泡；加 3s 容差后正确消费。
    const content_json = JSON.stringify({ text: 'clock skew test' })
    const pending = filterPendingOptimisticMessages({
      chatMessages: [
        chatMessage({
          content_json,
          created_at: Date.parse('2026-05-31T10:00:00.000Z'), // Mac 时间（早 500ms）
          id: 'srv-echo',
        }),
      ],
      optimisticMessages: [
        optimisticMessage({
          clientNonce: 'nonce-clk',
          content_json,
          created_at: Date.parse('2026-05-31T10:00:00.500Z'), // 手机时间（晚 500ms）
          id: 'opt-clk',
        }),
      ],
    })
    expect(pending).toEqual([])
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

// #26：带附件的消息，optimistic（attachments[] + caption）必须被服务端 media echo
// （media:{filename} + text="[filename]"）按文件名消掉——否则 1 张图出现 2 个图气泡（真图+空框）。
const imageOptimisticJson = (filename: string, caption: string) =>
  JSON.stringify({
    attachments: [{ filename, mime_type: 'image/jpeg', url: `file:///${filename}` }],
    media: { filename, mime_type: 'image/jpeg', url: `file:///${filename}` },
    text: caption,
  })

const serverMediaEchoJson = (filename: string) =>
  JSON.stringify({
    media: {
      file_id: 'f1',
      filename,
      mime_type: 'image/jpeg',
      size: 1,
      url: `/api/mobile/uploads/${filename}`,
    },
    text: `[${filename}]`,
  })

describe('filterPendingOptimisticMessages — attachments (#26)', () => {
  test('a server media echo consumes the optimistic image even though their text differs', () => {
    const pending = filterPendingOptimisticMessages({
      chatMessages: [
        chatMessage({
          content_json: serverMediaEchoJson('photo.jpg'),
          created_at: Date.parse('2026-05-31T10:00:05Z'),
          id: 'srv-media',
        }),
      ],
      optimisticMessages: [
        optimisticMessage({
          clientNonce: 'n',
          content_json: imageOptimisticJson('photo.jpg', '看这个'),
          created_at: Date.parse('2026-05-31T10:00:00Z'),
          id: 'opt-img',
        }),
      ],
    })
    // optimistic 被消掉 → 不再出现重复的图气泡（剩服务端那条）。
    expect(pending).toEqual([])
  })

  test('the "[附件:...]" text echo does NOT consume the optimistic image (it stays its own bubble)', () => {
    const pending = filterPendingOptimisticMessages({
      chatMessages: [
        chatMessage({
          content_json: JSON.stringify({ text: '[附件: photo.jpg]\n看这个' }),
          created_at: Date.parse('2026-05-31T10:00:05Z'),
          id: 'srv-text',
        }),
      ],
      optimisticMessages: [
        optimisticMessage({
          clientNonce: 'n',
          content_json: imageOptimisticJson('photo.jpg', '看这个'),
          created_at: Date.parse('2026-05-31T10:00:00Z'),
          id: 'opt-img',
        }),
      ],
    })
    // 文字 echo 按文字 key、optimistic 按 media key，互不消费 → optimistic 仍在（等它的 media echo）。
    expect(pending).toHaveLength(1)
    expect(pending[0]?.id).toBe('opt-img')
  })

  test('with both server echoes present, only the media echo consumes the optimistic image', () => {
    const pending = filterPendingOptimisticMessages({
      chatMessages: [
        chatMessage({
          content_json: serverMediaEchoJson('photo.jpg'),
          created_at: Date.parse('2026-05-31T10:00:05Z'),
          id: 'srv-media',
        }),
        chatMessage({
          content_json: JSON.stringify({ text: '[附件: photo.jpg]\n看这个' }),
          created_at: Date.parse('2026-05-31T10:00:06Z'),
          id: 'srv-text',
        }),
      ],
      optimisticMessages: [
        optimisticMessage({
          clientNonce: 'n',
          content_json: imageOptimisticJson('photo.jpg', '看这个'),
          created_at: Date.parse('2026-05-31T10:00:00Z'),
          id: 'opt-img',
        }),
      ],
    })
    expect(pending).toEqual([])
  })

  test('a pre-existing media echo (older than the new send) does NOT consume the new optimistic image', () => {
    const pending = filterPendingOptimisticMessages({
      chatMessages: [
        chatMessage({
          content_json: serverMediaEchoJson('photo.jpg'),
          created_at: Date.parse('2026-05-31T09:00:00Z'),
          id: 'srv-old',
        }),
      ],
      optimisticMessages: [
        optimisticMessage({
          clientNonce: 'n',
          content_json: imageOptimisticJson('photo.jpg', '再发一次'),
          created_at: Date.parse('2026-05-31T10:00:00Z'),
          id: 'opt-new',
        }),
      ],
    })
    // 沿用 #23 时间门控：早于本次发送的历史图 echo 不能消费新发的图。
    expect(pending).toHaveLength(1)
    expect(pending[0]?.id).toBe('opt-new')
  })
})
