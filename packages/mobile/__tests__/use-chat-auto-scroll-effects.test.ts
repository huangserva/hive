/**
 * @vitest-environment jsdom
 *
 * 钟馗 blocking 焊死的关键穿透测：
 *
 * 上单只补了 shouldAutoScrollOnNewMessage 纯函数 + 8 测，但 index.tsx 没引/没调，
 * 真实滚动行为仍由 useFocusEffect + latestMessageToken effect 那套 ref 链决定 →
 * 把 useFocusEffect deps 改回 [allMessages.length, scrollToLatestMessage] 旧 bug
 * 形态，纯函数 8 测仍全绿 = 假覆盖。
 *
 * 本测试通过：
 *   1. 抽出 `useChatAutoScrollEffects` 把两条副作用 hook 化，注入 useFocusEffect +
 *      onScroll 让它们可单测
 *   2. 让 hook 内部消费 `shouldAutoScrollOnNewMessage` 当唯一决策来源
 *   3. 测试用 mock useFocusEffect（行为：cb 引用变就重跑，等价 react-navigation 真行为）
 *      + spy onScroll 计数，断言"messagesCount 单独变化不触发 onScroll"——这条卡住
 *      "把 messagesCount 进 useFocusEffect deps"的回归
 *
 * 自验：把 hook 里的 `useCallback(focusEffectCallback, [getInputs, onScroll])` 改成
 *   `useCallback(focusEffectCallback, [getInputs, onScroll, messagesCount])`（旧 bug
 *   形态），"穿透命门"那条必挂红。
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 与项目其他 react-test 文件一致：让 @testing-library/react 跟 hook 共用同一份 React。
// @ts-expect-error This test must share the root React instance used by @testing-library/react.
vi.mock('react', async () => await import('../../../node_modules/react/index.js'))

import type { AutoScrollIntent } from '../src/lib/chat-auto-scroll'
import {
  type UseChatAutoScrollEffectsOptions,
  type UseFocusEffectLike,
  useChatAutoScrollEffects,
} from '../src/lib/use-chat-auto-scroll-effects'

interface DriverProps {
  messagesCount: number
  latestMessageToken: string
  getInputs: (kind: 'new-message' | 'focus-enter') => AutoScrollIntent
  onScroll: (kind: 'new-message' | 'focus-enter') => void
  useFocusEffectMock: UseFocusEffectLike
}

const useDriver = (props: DriverProps) => {
  const opts: UseChatAutoScrollEffectsOptions = {
    getInputs: props.getInputs,
    latestMessageToken: props.latestMessageToken,
    messagesCount: props.messagesCount,
    onScroll: props.onScroll,
    useFocusEffect: props.useFocusEffectMock,
  }
  useChatAutoScrollEffects(opts)
}

const intent = (overrides: Partial<AutoScrollIntent> = {}): AutoScrollIntent => ({
  isDragging: false,
  isFocusEnter: false,
  isNearBottom: false,
  isUserSend: false,
  ...overrides,
})

const makeFocusMock = (): {
  fn: UseFocusEffectLike
  spy: ReturnType<typeof vi.fn>
} => {
  const spy = vi.fn((cb: () => undefined | (() => void)) => {
    useEffect(() => {
      cb()
    }, [cb])
  }) as unknown as ReturnType<typeof vi.fn>
  return { fn: spy as unknown as UseFocusEffectLike, spy }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useChatAutoScrollEffects（穿透测：抖动 bug 真路径锁住）', () => {
  let onScroll: ReturnType<typeof vi.fn>
  let focusMock: ReturnType<typeof makeFocusMock>

  beforeEach(() => {
    onScroll = vi.fn()
    focusMock = makeFocusMock()
  })

  it('命门：user 上翻历史（isNearBottom=false）+ token 变化 → onScroll 不被调用（治抖动）', () => {
    // 所有 kind 都返"不滚"的 intent：模拟 user 上翻历史中，新消息进来，决策表全 false
    const getInputs = vi.fn(() => intent({ isNearBottom: false }))
    const { rerender } = renderHook(
      ({ token }: { token: string }) =>
        useDriver({
          getInputs,
          latestMessageToken: token,
          messagesCount: 5,
          onScroll,
          useFocusEffectMock: focusMock.fn,
        }),
      { initialProps: { token: 'msg-1' } }
    )
    onScroll.mockClear()
    act(() => {
      rerender({ token: 'msg-2' })
    })
    expect(onScroll).not.toHaveBeenCalled()
  })

  it('回归：在底部（isNearBottom=true，new-message kind）+ token 变化 → onScroll("new-message") 被调用', () => {
    // focus-enter 强制 isFocusEnter=false 让 mount 不滚（隔离掉 mount 的副作用）；
    // new-message 给 isNearBottom=true → 该滚
    const getInputs = vi.fn((kind: 'new-message' | 'focus-enter') =>
      kind === 'new-message' ? intent({ isNearBottom: true }) : intent({ isFocusEnter: false })
    )
    const { rerender } = renderHook(
      ({ token }: { token: string }) =>
        useDriver({
          getInputs,
          latestMessageToken: token,
          messagesCount: 5,
          onScroll,
          useFocusEffectMock: focusMock.fn,
        }),
      { initialProps: { token: 'msg-1' } }
    )
    onScroll.mockClear()
    act(() => {
      rerender({ token: 'msg-2' })
    })
    expect(onScroll).toHaveBeenCalledTimes(1)
    expect(onScroll).toHaveBeenCalledWith('new-message')
  })

  it('回归：user 自己发消息（isUserSend=true，即便 isNearBottom=false） → onScroll 被调用', () => {
    const getInputs = vi.fn((kind: 'new-message' | 'focus-enter') =>
      kind === 'new-message' ? intent({ isUserSend: true }) : intent({ isFocusEnter: false })
    )
    const { rerender } = renderHook(
      ({ token }: { token: string }) =>
        useDriver({
          getInputs,
          latestMessageToken: token,
          messagesCount: 5,
          onScroll,
          useFocusEffectMock: focusMock.fn,
        }),
      { initialProps: { token: 'msg-1' } }
    )
    onScroll.mockClear()
    act(() => {
      rerender({ token: 'msg-2' })
    })
    expect(onScroll).toHaveBeenCalledWith('new-message')
  })

  it('回归：focus 进入 + 有消息 → onScroll("focus-enter") 被调用', () => {
    const getInputs = vi.fn((kind: 'new-message' | 'focus-enter') =>
      kind === 'focus-enter' ? intent({ isFocusEnter: true }) : intent()
    )
    renderHook(() =>
      useDriver({
        getInputs,
        latestMessageToken: '',
        messagesCount: 5,
        onScroll,
        useFocusEffectMock: focusMock.fn,
      })
    )
    expect(onScroll).toHaveBeenCalledWith('focus-enter')
  })

  it('messagesCount=0 → focus 进入不滚（不会瞎滚空列表）', () => {
    const getInputs = vi.fn((kind: 'new-message' | 'focus-enter') =>
      kind === 'focus-enter' ? intent({ isFocusEnter: true }) : intent()
    )
    renderHook(() =>
      useDriver({
        getInputs,
        latestMessageToken: '',
        messagesCount: 0,
        onScroll,
        useFocusEffectMock: focusMock.fn,
      })
    )
    expect(onScroll).not.toHaveBeenCalled()
  })

  it('**穿透命门**：messagesCount 单独变化 → useFocusEffect 的 callback **不重触发**', () => {
    // 这条是钟馗要的：写回旧 bug（把 messagesCount 进 useFocusEffect 的 callback 的
    // useCallback deps）必须挂红。
    //
    // 机制：mock 的 useFocusEffectMock 实现是"cb 引用变就重跑"——等价 react-navigation
    // 真行为。hook 内 useCallback deps 错塞 messagesCount，messagesCount 变化时 cb
    // 引用变 → useFocusEffectMock 重触发 → 重跑 focus-enter 分支 → 命中 onScroll。
    //
    // 正确实现下（messagesCount 走 ref），cb 引用稳定，本测断言挡住回归。
    const focusEnterCalls = { count: 0 }
    const getInputs = vi.fn((kind: 'new-message' | 'focus-enter') => {
      if (kind === 'focus-enter') focusEnterCalls.count += 1
      // focus-enter 给"该滚"的 intent，这样如果 useFocusEffect 被错误重触发就会 onScroll
      return kind === 'focus-enter' ? intent({ isFocusEnter: true }) : intent()
    })
    const { rerender } = renderHook(
      ({ count }: { count: number }) =>
        useDriver({
          getInputs,
          latestMessageToken: 'msg-1',
          messagesCount: count,
          onScroll,
          useFocusEffectMock: focusMock.fn,
        }),
      { initialProps: { count: 5 } }
    )
    // mount：useFocusEffectMock 跑了 1 次（合理 focus enter）
    const focusEnterCallsAfterMount = focusEnterCalls.count
    onScroll.mockClear()
    // 模拟新消息到达：messagesCount 从 5 变 6（latestMessageToken 不变 → token effect 不重跑）
    act(() => {
      rerender({ count: 6 })
    })
    // 命门：messagesCount 变化【不应】让 useFocusEffectMock 重触发，因此 focus-enter
    // 分支不重跑，onScroll 不被再次调用。
    expect(focusEnterCalls.count).toBe(focusEnterCallsAfterMount)
    expect(onScroll).not.toHaveBeenCalled()
  })

  it('回归保险：messagesCount 变化 + latestMessageToken 也变化 → new-message 决策跑（不被 focus 路径污染）', () => {
    // 双变量场景：messagesCount 变 + token 变。期望只走 new-message 分支一次，focus
    // 分支不应被 messagesCount 变化错误重触发。
    const focusEnterCalls = { count: 0 }
    const getInputs = vi.fn((kind: 'new-message' | 'focus-enter') => {
      if (kind === 'focus-enter') focusEnterCalls.count += 1
      return kind === 'new-message'
        ? intent({ isNearBottom: true })
        : intent({ isFocusEnter: false })
    })
    const { rerender } = renderHook(
      ({ count, token }: { count: number; token: string }) =>
        useDriver({
          getInputs,
          latestMessageToken: token,
          messagesCount: count,
          onScroll,
          useFocusEffectMock: focusMock.fn,
        }),
      { initialProps: { count: 5, token: 'msg-1' } }
    )
    const focusEnterCallsAfterMount = focusEnterCalls.count
    onScroll.mockClear()
    act(() => {
      rerender({ count: 6, token: 'msg-2' })
    })
    expect(focusEnterCalls.count).toBe(focusEnterCallsAfterMount)
    expect(onScroll).toHaveBeenCalledTimes(1)
    expect(onScroll).toHaveBeenCalledWith('new-message')
  })

  it('isDragging=true 永远不滚（即便 token 变 + isNearBottom=true，手势优先）', () => {
    const getInputs = vi.fn(() => intent({ isDragging: true, isNearBottom: true }))
    const { rerender } = renderHook(
      ({ token }: { token: string }) =>
        useDriver({
          getInputs,
          latestMessageToken: token,
          messagesCount: 5,
          onScroll,
          useFocusEffectMock: focusMock.fn,
        }),
      { initialProps: { token: 'msg-1' } }
    )
    onScroll.mockClear()
    act(() => {
      rerender({ token: 'msg-2' })
    })
    expect(onScroll).not.toHaveBeenCalled()
  })
})
