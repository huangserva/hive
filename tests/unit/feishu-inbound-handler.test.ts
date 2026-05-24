import { describe, expect, test, vi } from 'vitest'

import {
  FEISHU_ORCHESTRATOR_OFFLINE_TEXT,
  type FeishuInboundChatEvent,
  formatFeishuInboundPrompt,
  handleFeishuInbound,
} from '../../src/server/feishu-inbound-handler.js'

const makeEvent = (overrides: Partial<FeishuInboundChatEvent> = {}): FeishuInboundChatEvent => ({
  chatId: 'oc_test',
  senderName: 'ou_sender123',
  text: '你好世界',
  userId: 'ou_sender123',
  ...overrides,
})

const makeLogger = () => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
})

describe('formatFeishuInboundPrompt', () => {
  test('formats a complete inbound prompt', () => {
    const event = makeEvent({
      chatId: 'oc_xxx',
      messageId: 'om_xxx',
      senderName: 'ou_abc',
      text: '你好',
      userId: 'ou_abc',
    })
    const result = formatFeishuInboundPrompt(event)
    expect(result).toContain(
      '[来自飞书 chat=oc_xxx，sender=ou_abc user_id=ou_abc message_id=om_xxx]'
    )
    expect(result).toContain('请用 team feishu reply 回复（Phase 2 接通后生效）。')
    expect(result).toContain('---')
    expect(result).toContain('你好')
  })

  test('preserves special characters in text', () => {
    const event = makeEvent({ text: 'test "quotes" & <tags>\nnewlines' })
    const result = formatFeishuInboundPrompt(event)
    expect(result).toContain('test "quotes" & <tags>\nnewlines')
  })

  test('handles unicode chat_id', () => {
    const event = makeEvent({ chatId: 'oc_群名_测试' })
    expect(formatFeishuInboundPrompt(event)).toContain('chat=oc_群名_测试')
  })

  test('uses senderName field (which may be user_id when display name unavailable)', () => {
    const event = makeEvent({ senderName: 'ou_real_id' })
    expect(formatFeishuInboundPrompt(event)).toContain('sender=ou_real_id')
  })
})

describe('handleFeishuInbound', () => {
  test('calls recordUserInput when orchestrator is online', async () => {
    const store = { recordUserInput: vi.fn() }
    const agentRuntime = { getActiveRunByAgentId: vi.fn().mockReturnValue({ runId: 'run-1' }) }
    const logger = makeLogger()

    await handleFeishuInbound({
      agentRuntime,
      event: makeEvent(),
      logger,
      route: { orchestratorAgentId: 'ws-1:orchestrator', workspaceId: 'ws-1' },
      store,
    })

    expect(store.recordUserInput).toHaveBeenCalledOnce()
    expect(store.recordUserInput).toHaveBeenCalledWith(
      'ws-1',
      'ws-1:orchestrator',
      expect.any(String)
    )
    const recordedText = store.recordUserInput.mock.calls[0][2] as string
    expect(recordedText).toContain('[来自飞书 chat=oc_test')
    expect(recordedText).toContain('你好世界')
  })

  test('does not call recordUserInput when orchestrator is offline', async () => {
    const store = { recordUserInput: vi.fn() }
    const agentRuntime = { getActiveRunByAgentId: vi.fn().mockReturnValue(undefined) }
    const logger = makeLogger()
    const replyText = vi.fn().mockResolvedValue(undefined)

    await handleFeishuInbound({
      agentRuntime,
      event: makeEvent(),
      logger,
      replyText,
      route: { orchestratorAgentId: 'ws-1:orchestrator', workspaceId: 'ws-1' },
      store,
    })

    expect(store.recordUserInput).not.toHaveBeenCalled()
  })

  test('sends offline reply text when orchestrator is offline', async () => {
    const store = { recordUserInput: vi.fn() }
    const agentRuntime = { getActiveRunByAgentId: vi.fn().mockReturnValue(undefined) }
    const logger = makeLogger()
    const replyText = vi.fn().mockResolvedValue(undefined)

    await handleFeishuInbound({
      agentRuntime,
      event: makeEvent({ chatId: 'oc_chat42' }),
      logger,
      replyText,
      route: { orchestratorAgentId: 'ws-1:orchestrator', workspaceId: 'ws-1' },
      store,
    })

    expect(replyText).toHaveBeenCalledOnce()
    expect(replyText).toHaveBeenCalledWith('oc_chat42', FEISHU_ORCHESTRATOR_OFFLINE_TEXT)
  })

  test('does not crash when replyText is undefined and orchestrator offline', async () => {
    const store = { recordUserInput: vi.fn() }
    const agentRuntime = { getActiveRunByAgentId: vi.fn().mockReturnValue(undefined) }
    const logger = makeLogger()

    await handleFeishuInbound({
      agentRuntime,
      event: makeEvent(),
      logger,
      route: { orchestratorAgentId: 'ws-1:orchestrator', workspaceId: 'ws-1' },
      store,
    })

    expect(store.recordUserInput).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalled()
  })

  test('logs error when replyText throws', async () => {
    const store = { recordUserInput: vi.fn() }
    const agentRuntime = { getActiveRunByAgentId: vi.fn().mockReturnValue(undefined) }
    const logger = makeLogger()
    const replyText = vi.fn().mockRejectedValue(new Error('network failure'))

    await handleFeishuInbound({
      agentRuntime,
      event: makeEvent(),
      logger,
      replyText,
      route: { orchestratorAgentId: 'ws-1:orchestrator', workspaceId: 'ws-1' },
      store,
    })

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('feishu offline reply failed'),
      expect.any(Error)
    )
  })

  test('logs warn with chat_id and workspace_id when orchestrator offline', async () => {
    const store = { recordUserInput: vi.fn() }
    const agentRuntime = { getActiveRunByAgentId: vi.fn().mockReturnValue(undefined) }
    const logger = makeLogger()

    await handleFeishuInbound({
      agentRuntime,
      event: makeEvent({ chatId: 'oc_abc' }),
      logger,
      route: { orchestratorAgentId: 'ws-2:orchestrator', workspaceId: 'ws-2' },
      store,
    })

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('chat_id=oc_abc'))
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('workspace_id=ws-2'))
  })
})
