import { describe, expect, it } from 'vitest'

import { shouldAutoScrollOnNewMessage } from '../src/lib/chat-auto-scroll'

describe('shouldAutoScrollOnNewMessage（聊天页自动滚动 vs 用户手势抢决策表）', () => {
  it('命门：user 上翻历史（isNearBottom=false）+ 来 incoming 消息 → 不滚（治本次抖动 bug）', () => {
    // 写反 = 抖动 bug 回归。这条断言挡死"轮询/incoming 消息打扰上翻历史的 user"。
    expect(
      shouldAutoScrollOnNewMessage({
        isDragging: false,
        isFocusEnter: false,
        isNearBottom: false,
        isUserSend: false,
      })
    ).toBe(false)
  })

  it('在底部（isNearBottom=true）+ 来 incoming 消息 → 滚（回归保证 user 在底部能自动看到新消息）', () => {
    expect(
      shouldAutoScrollOnNewMessage({
        isDragging: false,
        isFocusEnter: false,
        isNearBottom: true,
        isUserSend: false,
      })
    ).toBe(true)
  })

  it('user 自己发消息 → 永远滚（即便 isNearBottom=false，回归保证 user 看到自己的气泡）', () => {
    expect(
      shouldAutoScrollOnNewMessage({
        isDragging: false,
        isFocusEnter: false,
        isNearBottom: false,
        isUserSend: true,
      })
    ).toBe(true)
  })

  it('focus 进入（首次 / tab 切回） → 滚（即便 isNearBottom 状态未知，UX 合理默认）', () => {
    expect(
      shouldAutoScrollOnNewMessage({
        isDragging: false,
        isFocusEnter: true,
        isNearBottom: false,
        isUserSend: false,
      })
    ).toBe(true)
  })

  it('isDragging=true → 永远不滚（不抢用户手势）', () => {
    // 即便 isUserSend / isFocusEnter / isNearBottom 都为 true，拖拽中也不滚——
    // 防止 release drag 瞬间被强行拽走。
    expect(
      shouldAutoScrollOnNewMessage({
        isDragging: true,
        isFocusEnter: true,
        isNearBottom: true,
        isUserSend: true,
      })
    ).toBe(false)
  })

  it('isUserSend 优先于 isFocusEnter（任一为 true 都触发，但两者均无副作用）', () => {
    // 防御性：两个触发源同帧到来时仍输出 true，不会因为优先级出错变 false。
    expect(
      shouldAutoScrollOnNewMessage({
        isDragging: false,
        isFocusEnter: true,
        isNearBottom: false,
        isUserSend: true,
      })
    ).toBe(true)
  })

  it('isDragging 优先于所有正向信号（手势优先级最高）', () => {
    // 验证不变量：拖拽中无论其他 flag 多么"应该滚"，都不滚。
    for (const isUserSend of [true, false]) {
      for (const isFocusEnter of [true, false]) {
        for (const isNearBottom of [true, false]) {
          expect(
            shouldAutoScrollOnNewMessage({
              isDragging: true,
              isFocusEnter,
              isNearBottom,
              isUserSend,
            })
          ).toBe(false)
        }
      }
    }
  })

  it('回归：user 上翻历史 + 拖拽中 + 来消息 → 不滚（双重保护）', () => {
    expect(
      shouldAutoScrollOnNewMessage({
        isDragging: true,
        isFocusEnter: false,
        isNearBottom: false,
        isUserSend: false,
      })
    ).toBe(false)
  })
})
