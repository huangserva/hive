import { describe, expect, test, vi } from 'vitest'

import {
  createApprovalOutboxItem,
  createDispatchOutboxItem,
  createMobileOutboxState,
  createPromptOutboxItem,
  enqueueOutboxItem,
  flushOutboxState,
  getOutboxCounts,
  type MobileOutboxItem,
  parseOutboxState,
  removeOutboxItem,
  retryFailedOutboxItems,
  serializeOutboxState,
} from '../../packages/mobile/src/api/mobile-outbox.js'

describe('mobile outbox helpers', () => {
  test('enqueues offline actions, preserves order, and serializes round-trip', async () => {
    const prompt = createPromptOutboxItem(
      { text: 'Send summary', workspaceId: 'ws-1' },
      { createdAt: 100, id: 'prompt-1' }
    )
    const dispatch = createDispatchOutboxItem(
      { task: 'Do thing', workerId: 'worker-1', workspaceId: 'ws-1' },
      { createdAt: 200, id: 'dispatch-1' }
    )
    const approval = createApprovalOutboxItem(
      { approvalId: 'approval-1', decision: 'allow', workspaceId: 'ws-1' },
      { createdAt: 300, id: 'approval-1' }
    )

    const state = enqueueOutboxItem(
      enqueueOutboxItem(enqueueOutboxItem(createMobileOutboxState(), prompt), dispatch),
      approval
    )

    expect(getOutboxCounts(state)).toEqual({
      failedCount: 0,
      queuedCount: 3,
      sendingCount: 0,
    })

    const parsed = parseOutboxState(serializeOutboxState(state))
    expect(parsed.items.map((item) => item.id)).toEqual(['prompt-1', 'dispatch-1', 'approval-1'])
    expect(parsed.items.map((item) => item.status)).toEqual(['queued', 'queued', 'queued'])
  })

  test('allows identical prompt text with distinct ids so legitimate repeated sends are preserved', () => {
    const first = createPromptOutboxItem(
      { text: 'Ping orchestrator', workspaceId: 'ws-1' },
      { id: 'prompt-1' }
    )
    const second = createPromptOutboxItem(
      { text: 'Ping orchestrator', workspaceId: 'ws-1' },
      { id: 'prompt-2' }
    )

    const state = enqueueOutboxItem(enqueueOutboxItem(createMobileOutboxState(), first), second)
    expect(state.items).toHaveLength(2)
    expect(state.items.map((item) => item.id)).toEqual(['prompt-1', 'prompt-2'])
  })

  test('dedupes the same id so replaying a queued action does not enqueue twice', () => {
    const first = createPromptOutboxItem(
      { text: 'Ping orchestrator', workspaceId: 'ws-1' },
      { id: 'prompt-1' }
    )
    const replay = createPromptOutboxItem(
      { text: 'Ping orchestrator', workspaceId: 'ws-1' },
      { id: 'prompt-1' }
    )

    const state = enqueueOutboxItem(enqueueOutboxItem(createMobileOutboxState(), first), replay)
    expect(state.items).toHaveLength(1)
    expect(state.items[0]?.id).toBe('prompt-1')
  })

  test('flushes queued items in order, removes successes, and leaves failed items retryable', async () => {
    const state = enqueueOutboxItem(
      enqueueOutboxItem(
        createMobileOutboxState(),
        createPromptOutboxItem({ text: 'First', workspaceId: 'ws-1' }, { id: 'prompt-1' })
      ),
      createDispatchOutboxItem(
        { task: 'Second', workerId: 'worker-1', workspaceId: 'ws-1' },
        { id: 'dispatch-1' }
      )
    )
    const sendItem = vi.fn(async (item: (typeof state.items)[number]) => {
      if (item.id === 'dispatch-1') throw new Error('network down')
    })

    const flushed = await flushOutboxState(state, sendItem)

    expect(sendItem).toHaveBeenCalledTimes(2)
    expect(sendItem.mock.calls.map((call) => call[0]?.id)).toEqual(['prompt-1', 'dispatch-1'])
    expect(flushed.state.items).toHaveLength(1)
    expect(flushed.state.items[0]?.id).toBe('dispatch-1')
    expect(flushed.state.items[0]?.status).toBe('failed')
    expect(flushed.state.items[0]?.lastError).toBe('network down')
    expect(flushed.sentCount).toBe(1)
  })

  test('failed items can be retried after resetting them to queued', async () => {
    const failed = {
      ...createPromptOutboxItem({ text: 'Retry me', workspaceId: 'ws-1' }, { id: 'prompt-1' }),
      lastError: 'offline',
      status: 'failed' as const,
    }
    const retried = retryFailedOutboxItems({ items: [failed] })
    const sendItem = vi.fn(async () => {})

    const flushed = await flushOutboxState(retried, sendItem)

    expect(sendItem).toHaveBeenCalledTimes(1)
    expect(removeOutboxItem(flushed.state, 'prompt-1').items).toHaveLength(0)
    expect(flushed.sentCount).toBe(1)
  })

  test('a failed item does not block later queued items from flushing', async () => {
    const state = {
      items: [
        createPromptOutboxItem({ text: 'Blocked first', workspaceId: 'ws-1' }, { id: 'prompt-1' }),
        {
          ...createDispatchOutboxItem(
            { task: 'Should stay queued', workerId: 'worker-1', workspaceId: 'ws-1' },
            { id: 'dispatch-1' }
          ),
          lastError: 'offline',
          status: 'failed' as const,
        },
        createApprovalOutboxItem(
          { approvalId: 'approval-1', decision: 'allow', workspaceId: 'ws-1' },
          { id: 'approval-1' }
        ),
      ],
    }

    const sendItem = vi.fn(async (item: MobileOutboxItem) => {
      if (item.id === 'prompt-1') throw new Error('network down')
    })

    const flushed = await flushOutboxState(state, sendItem)

    expect(sendItem).toHaveBeenCalledTimes(2)
    expect(sendItem.mock.calls.map((call) => call[0]?.id)).toEqual(['prompt-1', 'approval-1'])
    expect(flushed.state.items.map((item) => item.id)).toEqual(['prompt-1', 'dispatch-1'])
    expect(flushed.state.items[0]?.status).toBe('failed')
    expect(flushed.state.items[1]?.status).toBe('failed')
    expect(flushed.sentIds).toEqual(['approval-1'])
    expect(flushed.failedItems).toEqual([{ error: 'network down', id: 'prompt-1' }])
  })
})
