/**
 * 把"focus 进入要不要滚 + 新消息到达要不要滚"两条副作用抽成可测 hook，并强制让
 * `shouldAutoScrollOnNewMessage` 成为决策唯一真相。
 *
 * 抖动 bug 真因（2026-06-14 PM adb 录帧坐实）：旧实现把 `allMessages.length` 放进
 * useFocusEffect 的 callback deps，新消息每次重跑 callback → 无条件 forceScroll →
 * user 上翻历史被拽走。
 *
 * 抽 hook 的意义（钟馗 blocking 焊死的关键）：
 *   - 在组件里直接写 useFocusEffect + useEffect 那一套 ref 链很难单测穿透
 *   - 抽成 hook 后注入 mock useFocusEffect + 注入 spy scrollFn，就能写测试卡住
 *     "useFocusEffect 是否被 messagesCount 变化误触发"这条命门
 *   - 注释里那个"改回 [allMessages.length, scrollToLatestMessage] 必红"的自验
 *     在 hook 单测里能真跑（hook 内部 useCallback deps 错就挂红）
 */

import { useCallback, useEffect, useRef } from 'react'

import { type AutoScrollIntent, shouldAutoScrollOnNewMessage } from './chat-auto-scroll'

/**
 * React Navigation 的 `useFocusEffect` 类型；接收回调，回调可返清理函数。
 * 测试时注入"回调引用变就重跑"的简易实现来还原 navigation 的真实行为。
 */
export type UseFocusEffectLike = (callback: () => undefined | (() => void)) => void

export interface UseChatAutoScrollEffectsOptions {
  /** 当前消息列表长度——决定 focus 进入要不要滚。**严禁**进 useFocusEffect deps。 */
  messagesCount: number
  /** 列表最新消息的 token（外部已 useMemo 出来）；任意变化都视作"来了新消息"。 */
  latestMessageToken: string
  /** 读取当前决策上下文(每次触发时按 kind 从 refs 拿真实值)。 */
  getInputs: (kind: 'new-message' | 'focus-enter') => AutoScrollIntent
  /** 真正执行滚动（动画 vs 直跳由调用方决定）。 */
  onScroll: (kind: 'new-message' | 'focus-enter') => void
  /** 注入的 useFocusEffect（生产传 react-navigation 的；测试传 mock）。 */
  useFocusEffect: UseFocusEffectLike
}

export const useChatAutoScrollEffects = ({
  messagesCount,
  latestMessageToken,
  getInputs,
  onScroll,
  useFocusEffect,
}: UseChatAutoScrollEffectsOptions): void => {
  // 关键：用 ref 读 messagesCount，**绝不**进 useFocusEffect 的 callback deps。
  // 直接把 messagesCount 放进 deps 就是抖动 bug 回归。
  const hasMessagesRef = useRef(messagesCount > 0)
  useEffect(() => {
    hasMessagesRef.current = messagesCount > 0
  }, [messagesCount])

  const focusEffectCallback = useCallback(() => {
    if (!hasMessagesRef.current) return undefined
    const inputs = getInputs('focus-enter')
    if (shouldAutoScrollOnNewMessage(inputs)) {
      onScroll('focus-enter')
    }
    return undefined
  }, [getInputs, onScroll])
  useFocusEffect(focusEffectCallback)

  // 新消息到达：latestMessageToken 变化时跑；决策走纯函数。
  // user 上翻历史时 getInputs() 返 isNearBottom=false + !isUserSend + !isFocusEnter →
  // 决策表输出 false → 不滚（治抖动）。
  useEffect(() => {
    if (!latestMessageToken) return
    const inputs = getInputs('new-message')
    if (shouldAutoScrollOnNewMessage(inputs)) {
      onScroll('new-message')
    }
  }, [latestMessageToken, getInputs, onScroll])
}
