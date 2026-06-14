/**
 * Chat 列表"是否应该自动滚到底"的决策（纯函数，可单测）。
 *
 * 真因背景（2026-06-14 PM adb 录帧坐实）：
 *   `useFocusEffect` 把 `allMessages.length` 放进了 deps，导致每条新消息（轮询刷新 /
 *   incoming / 系统事件 Mobile Reply Obligation Stalled 反复插入）都重跑 callback →
 *   无条件 `forceScrollToEndRef.current = true` → 即便 user 正下拉看历史也被强行
 *   拽回底部 → 跟下拉手势打架 → 抖动卡顿。
 *
 * 修法的核心是：**自动滚动必须尊重用户意图**。本函数把决策表抽离出来好让单测能锁住
 *   命门："user 上翻历史时来 incoming 消息不能滚"。
 *
 * 用法（消费方在 index.tsx 里）：
 *   - 用户自己发消息 → isUserSend=true → 永远滚（保证 user 看到自己的气泡）
 *   - 进入 focus（首次 / tab 切回） → isFocusEnter=true → 滚到底（合理 UX）
 *   - 收到他人消息 → 走 isNearBottom：在底部附近才跟随
 *   - 任何场景，user 正在拖拽 → 不抢滚（让用户自己控）
 */

export interface AutoScrollIntent {
  /** 列表距离底部是否在 AUTO_SCROLL_THRESHOLD_PX 阈值内（来自 onScroll 实时计算）。 */
  isNearBottom: boolean
  /** user 手指正在屏幕上拖拽（来自 onScrollBeginDrag/EndDrag）。 */
  isDragging: boolean
  /** 当前事件来自 user 自己发的消息（sendMessage 触发）。 */
  isUserSend: boolean
  /** 当前事件来自 screen focus 进入（首次或 tab 切回，useFocusEffect 触发）。 */
  isFocusEnter: boolean
}

/**
 * 决策表：
 *
 * | isDragging | isUserSend | isFocusEnter | isNearBottom | 输出 |
 * |------------|------------|--------------|--------------|------|
 * | true       | *          | *            | *            | **false**（不抢手势） |
 * | false      | true       | *            | *            | true  |
 * | false      | false      | true         | *            | true  |
 * | false      | false      | false        | true         | true（user 在底部跟随） |
 * | false      | false      | false        | false        | **false**（命门：user 上翻历史 + 来消息 → 别打扰） |
 *
 * 不变量：
 *   - `isDragging=true` 永远输出 false（user 手势优先于自动滚动）
 *   - `isNearBottom=false && !isUserSend && !isFocusEnter` 必输出 false（治本次抖动 bug）
 *   - `isUserSend` 或 `isFocusEnter` 任一为 true 时，绕过 isNearBottom 强制滚
 */
export const shouldAutoScrollOnNewMessage = (intent: AutoScrollIntent): boolean => {
  if (intent.isDragging) return false
  if (intent.isUserSend) return true
  if (intent.isFocusEnter) return true
  return intent.isNearBottom
}
