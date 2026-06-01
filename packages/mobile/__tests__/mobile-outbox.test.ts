import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  applyOutboxFlushResult,
  createPromptOutboxItem,
  enqueueOutboxItem,
  flushOutboxConcurrently,
  flushOutboxState,
  type MobileOutboxItem,
  type MobileOutboxState,
  parseOutboxState,
  serializeOutboxState,
} from '../src/api/mobile-outbox.js'

const prompt = (
  id: string,
  text: string,
  workspaceId = 'ws-1',
  status: 'queued' | 'failed' = 'queued'
): MobileOutboxItem => createPromptOutboxItem({ text, workspaceId }, { id, status })

describe('applyOutboxFlushResult (functional merge — concurrent-safe)', () => {
  test('removes only the sent ids and preserves everything else (incl. concurrent new items)', () => {
    const state: MobileOutboxState = {
      items: [prompt('a', 'A'), prompt('b', 'B'), prompt('c', 'C-concurrent')],
    }
    // a/b 发出去了；c 是 flush 期间并发入队的新项（不在 sentIds 里）。
    const next = applyOutboxFlushResult(state, { sentIds: ['a', 'b'], failedItems: [] })
    expect(next.items.map((i) => i.id)).toEqual(['c'])
  })

  test('marks every failed item failed with attempts+1 and keeps the rest', () => {
    const state: MobileOutboxState = {
      items: [prompt('a', 'A'), prompt('b', 'B'), prompt('c', 'C')],
    }
    const next = applyOutboxFlushResult(state, {
      sentIds: ['a'],
      failedItems: [
        { id: 'b', error: 'network down' },
        { id: 'c', error: 'boom' },
      ],
    })
    expect(next.items.map((i) => i.id)).toEqual(['b', 'c'])
    const [b, c] = next.items
    expect(b.status).toBe('failed')
    expect(b.lastError).toBe('network down')
    expect(b.attempts).toBe(1)
    expect(c.status).toBe('failed')
    expect(c.lastError).toBe('boom')
  })

  test('is a no-op shape when nothing was sent and nothing failed', () => {
    const state: MobileOutboxState = { items: [prompt('a', 'A')] }
    const next = applyOutboxFlushResult(state, { sentIds: [], failedItems: [] })
    expect(next.items.map((i) => i.id)).toEqual(['a'])
  })
})

describe('flushOutboxConcurrently — CRITICAL concurrent-enqueue race (BugA repro)', () => {
  // React 的 setOutbox 既接受值也接受 updater 函数。这个 store 精确模拟 React setState 语义：
  // value-update 整体覆盖；functional-update 基于「最新」state 计算。
  const makeStore = (initial: MobileOutboxState) => {
    let s = initial
    return {
      get: () => s,
      set: (updater: MobileOutboxState | ((current: MobileOutboxState) => MobileOutboxState)) => {
        s = typeof updater === 'function' ? updater(s) : updater
      },
    }
  }

  // 复现 mobile-runtime-context flushOutbox(:471-) 的命脉路径：对快照发送，flush 进行中（每条 RPC 阻塞）
  // 用户并发发一条新消息（函数式入队），flush 完成后该并发消息**必须仍在 outbox**（不被覆盖丢失）。
  // 退回 value-set 覆盖（applyOutboxFlushResult→直接 set 衍生 state）此断言必红。
  test('a message enqueued DURING an in-flight flush is NOT lost when the flush commits', async () => {
    const store = makeStore({ items: [prompt('a', 'hello-A')] })

    // 用门闩卡住发送，模拟 flush 期间的 1-22s RPC 窗口。
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const sendItem = async () => {
      await gate
    }

    // 启动 flush（对当前快照），但先不放行发送。
    const flushPromise = flushOutboxConcurrently(store.get(), sendItem, store.set)

    // flush 进行中：用户并发发一条新消息（函数式入队，正是 sendPromptToOrchestratorWithOutcome 的 queue 路径）。
    store.set((current) => enqueueOutboxItem(current, prompt('b', 'hello-B-concurrent')))

    // 放行发送 → flush 完成 → 函数式 commit。
    release()
    await flushPromise

    const ids = store.get().items.map((i) => i.id)
    expect(ids).toContain('b') // 并发消息幸存（核心断言）
    expect(ids).not.toContain('a') // 已发的被移除
    expect(ids).toEqual(['b'])
  })

  test('reports sentCount for the snapshot items actually sent', async () => {
    const store = makeStore({
      items: [prompt('a', 'A'), prompt('b', 'B')],
    })
    const { sentCount } = await flushOutboxConcurrently(store.get(), async () => {}, store.set)
    expect(sentCount).toBe(2)
    expect(store.get().items).toHaveLength(0)
  })
})

describe('flushOutboxState — single failure must not block the queue (BugH2 repro)', () => {
  // 旧实现：遇到第一条失败/failed 项即 break → 后续 queued 永远发不出。
  // 修复后：单条失败标 failed 并**继续**后续 queued。退回「break」此断言必红（b 不会被发出）。
  test('a failed item does not stop later queued items from being sent', async () => {
    const state: MobileOutboxState = {
      items: [prompt('a', 'will-fail'), prompt('b', 'should-still-send')],
    }
    const sent: string[] = []
    const result = await flushOutboxState(state, async (item) => {
      if (item.id === 'a') throw new Error('a failed')
      sent.push(item.id)
    })
    expect(sent).toEqual(['b']) // b 仍被发出（不被 a 的失败阻塞）
    expect(result.sentIds).toEqual(['b'])
    expect(result.failedItems.map((f) => f.id)).toEqual(['a'])
  })

  // 队头是历史 'failed' 项时，不得阻塞后面的 queued 项（旧实现 find 命中 failed→break）。
  test('a pre-existing failed item at the head does not block queued items behind it', async () => {
    const state: MobileOutboxState = {
      items: [prompt('old', 'old-failed', 'ws-1', 'failed'), prompt('new', 'new-queued')],
    }
    const sent: string[] = []
    const result = await flushOutboxState(state, async (item) => {
      sent.push(item.id)
    })
    expect(sent).toEqual(['new']) // 跳过队头 failed，发出后面的 queued
    expect(result.sentIds).toEqual(['new'])
    expect(result.failedItems).toEqual([]) // 历史 failed 项保持原样、未重发
  })
})

describe('enqueue/parse dedup by id, not text (BugH3 repro)', () => {
  // 旧实现按 kind:ws:text 去重 → 同文本第二条合法消息被静默丢弃。改 id 去重后两条都保留。
  // 退回文本 fingerprint 去重此断言必红（只剩一条）。
  test('two legitimate same-text messages with distinct ids are both kept', () => {
    let state: MobileOutboxState = { items: [] }
    state = enqueueOutboxItem(state, prompt('id-1', '好的'))
    state = enqueueOutboxItem(state, prompt('id-2', '好的'))
    expect(state.items.map((i) => i.id)).toEqual(['id-1', 'id-2'])
  })

  test('re-enqueuing the same id is idempotent (no duplicate)', () => {
    let state: MobileOutboxState = { items: [prompt('id-1', '好的')] }
    state = enqueueOutboxItem(state, prompt('id-1', '好的'))
    expect(state.items).toHaveLength(1)
  })

  test('parseOutboxState dedups by id and keeps same-text distinct-id items', () => {
    const serialized = serializeOutboxState({
      items: [prompt('id-1', '好的'), prompt('id-2', '好的'), prompt('id-1', '好的')],
    })
    const parsed = parseOutboxState(serialized)
    expect(parsed.items.map((i) => i.id)).toEqual(['id-1', 'id-2'])
  })
})

// BLOCKING：id 现在是去重键，randomId 必须可靠唯一。randomUUID 在 RN 上不保证（只保证 getRandomValues），
// fallback 退化成 outbox-${Date.now()} 会让同毫秒两条合法消息撞同 id → 被 id 去重静默误删（重造刚修的 bug）。
// 这两个测试用真实 createPromptOutboxItem（不传 id，走 randomId）+ 固定 Date.now + 抹掉 crypto 能力来复现。
describe('randomId must stay unique so id-dedup never silently merges same-ms messages (BLOCKING)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const enqueueTwoSameText = () => {
    let state: MobileOutboxState = { items: [] }
    state = enqueueOutboxItem(state, createPromptOutboxItem({ text: '好的', workspaceId: 'ws-1' }))
    state = enqueueOutboxItem(state, createPromptOutboxItem({ text: '好的', workspaceId: 'ws-1' }))
    return state
  }

  test('distinct ids via getRandomValues UUID when randomUUID is unavailable, same fixed ms', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    // randomUUID 缺失（RN 现实），但 getRandomValues 在（react-native-get-random-values 保证）。
    const realGetRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
    vi.stubGlobal('crypto', { getRandomValues: realGetRandomValues })

    const state = enqueueTwoSameText()
    expect(state.items).toHaveLength(2) // 两条合法消息都保留
    expect(state.items[0].id).not.toBe(state.items[1].id)
  })

  test('distinct ids via monotonic counter when crypto is entirely unavailable, same fixed ms', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    vi.stubGlobal('crypto', undefined)

    const state = enqueueTwoSameText()
    expect(state.items).toHaveLength(2)
    expect(state.items[0].id).not.toBe(state.items[1].id)
  })
})
