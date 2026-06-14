import { describe, expect, it } from 'vitest'

import {
  areMessageCardPropsEqual,
  type MessageCardMessageLike,
  type MessageCardPropsForEquality,
} from '../src/lib/message-card-equality'

const baseMessage = (overrides: Partial<MessageCardMessageLike> = {}): MessageCardMessageLike => ({
  id: 'msg-1',
  message_type: 'orch_reply',
  content_json: JSON.stringify({ text: 'hello' }),
  created_at: 1000,
  ...overrides,
})

const noopApprove = async () => true
const noopVoid = () => {}
const noopImage = () => {}
const noopVideo = () => {}
const sharedWorkers: readonly unknown[] = Object.freeze([])

const baseProps = (
  overrides: Partial<MessageCardPropsForEquality<MessageCardMessageLike>> = {}
): MessageCardPropsForEquality<MessageCardMessageLike> => ({
  message: baseMessage(),
  onApprove: noopApprove,
  onOpenApproval: noopVoid,
  onPreviewImage: noopImage,
  onPreviewVideo: noopVideo,
  runtimeHost: '192.168.1.44:4010',
  token: 'tok',
  workers: sharedWorkers,
  ...overrides,
})

describe('areMessageCardPropsEqual（MessageCard memo 比较器·治列表整片重渲染抖一下）', () => {
  it('全等 → 相等（跳过渲染）', () => {
    expect(areMessageCardPropsEqual(baseProps(), baseProps())).toBe(true)
  })

  it('message.id 变 → 不等（必重渲染）', () => {
    expect(
      areMessageCardPropsEqual(baseProps(), baseProps({ message: baseMessage({ id: 'msg-2' }) }))
    ).toBe(false)
  })

  it('message.content_json 变 → 不等', () => {
    expect(
      areMessageCardPropsEqual(
        baseProps(),
        baseProps({ message: baseMessage({ content_json: '{"text":"world"}' }) })
      )
    ).toBe(false)
  })

  it('message.message_type 变 → 不等（路由分支变）', () => {
    expect(
      areMessageCardPropsEqual(
        baseProps(),
        baseProps({ message: baseMessage({ message_type: 'user_text' }) })
      )
    ).toBe(false)
  })

  it('message.created_at 变 → 不等（时间戳影响 footer）', () => {
    expect(
      areMessageCardPropsEqual(
        baseProps(),
        baseProps({ message: baseMessage({ created_at: 2000 }) })
      )
    ).toBe(false)
  })

  it('命门：pending false→true → 不等（user 自发消息发出后 footer 圈圈要变√）', () => {
    expect(
      areMessageCardPropsEqual(
        baseProps({ message: baseMessage({ pending: false }) }),
        baseProps({ message: baseMessage({ pending: true }) })
      )
    ).toBe(false)
  })

  it('命门：queued 变 → 不等（离线排队状态切换）', () => {
    expect(
      areMessageCardPropsEqual(
        baseProps({ message: baseMessage({ queued: false }) }),
        baseProps({ message: baseMessage({ queued: true }) })
      )
    ).toBe(false)
  })

  it('命门：error 变 → 不等（发送失败 footer 要变红 X）', () => {
    expect(
      areMessageCardPropsEqual(
        baseProps({ message: baseMessage({ error: false }) }),
        baseProps({ message: baseMessage({ error: true }) })
      )
    ).toBe(false)
  })

  it('runtimeHost / token 变 → 不等（影响媒体 URL 拼接）', () => {
    expect(areMessageCardPropsEqual(baseProps(), baseProps({ runtimeHost: '10.0.0.1:4010' }))).toBe(
      false
    )
    expect(areMessageCardPropsEqual(baseProps(), baseProps({ token: 'tok-2' }))).toBe(false)
  })

  it('回调引用变 → 不等（任一 callback 引用变就重渲）', () => {
    const newApprove = async () => true
    expect(areMessageCardPropsEqual(baseProps(), baseProps({ onApprove: newApprove }))).toBe(false)
    expect(areMessageCardPropsEqual(baseProps(), baseProps({ onOpenApproval: () => {} }))).toBe(
      false
    )
    expect(areMessageCardPropsEqual(baseProps(), baseProps({ onPreviewImage: () => {} }))).toBe(
      false
    )
    expect(areMessageCardPropsEqual(baseProps(), baseProps({ onPreviewVideo: () => {} }))).toBe(
      false
    )
  })

  it('**核心命门**：非 worker_report 消息（orch_reply）+ 新 workers 引用 → 相等（治 churn 焊死）', () => {
    // 钟馗 blocking 焊：dashboard 每次 WS 推送都新 workers 数组引用，旧实现"无条件
    // 比 workers"让普通 orch_reply/user_text/image 消息也判不等 → 整列重渲 → memo
    // 等于白搭。本测产品改回"无条件比 workers"必红。
    const orchReply = baseMessage({ id: 'orch-1', message_type: 'orch_reply' })
    const newWorkers: readonly unknown[] = Object.freeze([])
    expect(
      areMessageCardPropsEqual(
        baseProps({ message: orchReply }),
        baseProps({ message: orchReply, workers: newWorkers })
      )
    ).toBe(true)
  })

  it('命门 同款 user_text + 新 workers 引用 → 相等（覆盖 outbound 路径，治 churn）', () => {
    const userText = baseMessage({ id: 'user-1', message_type: 'user_text' })
    const newWorkers: readonly unknown[] = Object.freeze([])
    expect(
      areMessageCardPropsEqual(
        baseProps({ message: userText }),
        baseProps({ message: userText, workers: newWorkers })
      )
    ).toBe(true)
  })

  it('回归：worker_report 消息 + workers 真变化（新引用 + 不同内容）→ 不等（worker 网格要更新）', () => {
    const workerReport = baseMessage({ id: 'wr-1', message_type: 'worker_report' })
    const prevWorkers: readonly unknown[] = Object.freeze([])
    const nextWorkers: readonly unknown[] = Object.freeze([{ name: 'zhang-fei', role: 'tester' }])
    expect(
      areMessageCardPropsEqual(
        baseProps({ message: workerReport, workers: prevWorkers }),
        baseProps({ message: workerReport, workers: nextWorkers })
      )
    ).toBe(false)
  })

  it('回归：worker_report 消息 + 同一 workers 引用 → 相等（worker 网格不变没必要重渲）', () => {
    const workerReport = baseMessage({ id: 'wr-1', message_type: 'worker_report' })
    const stableWorkers: readonly unknown[] = sharedWorkers
    expect(
      areMessageCardPropsEqual(
        baseProps({ message: workerReport, workers: stableWorkers }),
        baseProps({ message: workerReport, workers: stableWorkers })
      )
    ).toBe(true)
  })

  it('边界：message_type 一边 worker_report、一边 orch_reply → message_type 比较先挡（返 false 是路由分支变 而非 workers）', () => {
    // 防御性：message_type 变就 return false 已经在前面字段比较挡掉了，workers 分支
    // 走不到。即便 type 不同时如果走到 workers 分支也不会误判（因为 type 检查在前）。
    const workerReport = baseMessage({ id: 'm-1', message_type: 'worker_report' })
    const orchReply = baseMessage({ id: 'm-1', message_type: 'orch_reply' })
    expect(
      areMessageCardPropsEqual(
        baseProps({ message: workerReport }),
        baseProps({ message: orchReply })
      )
    ).toBe(false)
  })

  it('**核心命门**：allMessages 换数组身份但同一条 message 内容不变 → 相等（治 churn）', () => {
    // 模拟轮询：parent 把 chatMessages.map() 一次出新数组，但其中某条 message 是
    // 等值的（同 id / 同 content_json / 同状态）。memo 应跳过这条 MessageCard 重渲染。
    const prev = baseProps({ message: baseMessage({ id: 'msg-abc' }) })
    const next = baseProps({ message: baseMessage({ id: 'msg-abc' }) })
    expect(areMessageCardPropsEqual(prev, next)).toBe(true)
  })

  it('workspaceId / direction 变 → 不等（防御性）', () => {
    expect(
      areMessageCardPropsEqual(
        baseProps({ message: baseMessage({ workspaceId: 'ws_a' }) }),
        baseProps({ message: baseMessage({ workspaceId: 'ws_b' }) })
      )
    ).toBe(false)
    expect(
      areMessageCardPropsEqual(
        baseProps({ message: baseMessage({ direction: 'inbound' }) }),
        baseProps({ message: baseMessage({ direction: 'outbound' }) })
      )
    ).toBe(false)
  })
})
