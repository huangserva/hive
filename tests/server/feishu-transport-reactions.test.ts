import { describe, expect, test, vi } from 'vitest'

import { FeishuTransport } from '../../src/server/feishu-transport.js'
import type { RuntimeStore } from '../../src/server/runtime-store.js'

const makeLogger = () => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
})

const makeStore = () =>
  ({
    approvalLedger: {
      cleanup: vi.fn(),
      resolve: vi.fn(),
    },
    findFeishuBindingByChatId: vi.fn().mockReturnValue({
      chatId: 'oc_1',
      chatName: null,
      createdAt: 1,
      enabled: true,
      id: 'binding-1',
      workspaceId: 'ws-1',
    }),
    getActiveRunByAgentId: vi.fn().mockReturnValue({ runId: 'run-1' }),
    getWorkspaceSnapshot: vi.fn().mockReturnValue({ summary: { id: 'ws-1' } }),
    recordUserInput: vi.fn(),
  }) as unknown as RuntimeStore

const makeMessageEvent = () => ({
  message: {
    chat_id: 'oc_1',
    chat_type: 'p2p',
    content: JSON.stringify({ text: 'hello from feishu' }),
    message_id: 'om_1',
    message_type: 'text',
  },
  sender: {
    sender_id: {
      user_id: 'ou_1',
    },
  },
})

describe('FeishuTransport reactions', () => {
  test('adds EYE reaction for routed inbound text messages and injects message_id', async () => {
    const logger = makeLogger()
    const store = makeStore()
    const transport = new FeishuTransport({
      credentials: { appId: 'app_1', appSecret: 'secret_1' },
      logger,
      store,
    })
    const createReaction = vi.fn().mockResolvedValue({ data: { reaction_id: 'rx_eye' } })
    ;(
      transport as unknown as {
        client: { im: { v1: { messageReaction: { create: typeof createReaction } } } }
      }
    ).client.im.v1.messageReaction.create = createReaction

    await (
      transport as unknown as {
        handleMessageReceive: (event: ReturnType<typeof makeMessageEvent>) => Promise<void>
      }
    ).handleMessageReceive(makeMessageEvent())

    expect(createReaction).toHaveBeenCalledWith({
      data: { reaction_type: { emoji_type: 'EYE' } },
      path: { message_id: 'om_1' },
    })
    expect(store.recordUserInput).toHaveBeenCalledWith(
      'ws-1',
      'ws-1:orchestrator',
      expect.stringContaining('message_id=om_1')
    )
  })
})
