import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  createMobileOrchestratorReplyCapture,
  type MobileOrchestratorReplyCapture,
} from '../../src/server/mobile-orchestrator-reply-capture.js'
import { createPtyOutputBus, type PtyOutputBus } from '../../src/server/pty-output-bus.js'

const WS = 'ws-1'
const ORCH = `${WS}:orchestrator`
const RUN = 'run-1'
const FLUSH_MS = 50

interface CapturedMessage {
  direction: string
  messageType: string
  text: string
  workspaceId: string
}

const setup = () => {
  const outputBus: PtyOutputBus = createPtyOutputBus()
  const captured: CapturedMessage[] = []
  const capture: MobileOrchestratorReplyCapture = createMobileOrchestratorReplyCapture({
    flushDelayMs: FLUSH_MS,
    insertMobileChatMessage: (workspaceId, direction, messageType, contentJson) => {
      const text =
        messageType === 'orch_reply'
          ? ((JSON.parse(contentJson) as { text?: string }).text ?? '')
          : contentJson
      captured.push({ direction, messageType, text, workspaceId })
      return {
        content_json: contentJson,
        created_at: 0,
        direction,
        id: `msg-${captured.length}`,
        message_type: messageType,
        workspace_id: workspaceId,
      }
    },
    outputBus,
  })
  capture.attach(WS, ORCH, RUN)
  return { capture, captured, outputBus }
}

describe('mobile orchestrator reply capture', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('captures the orchestrator natural-language reply after a mobile turn opens a window', () => {
    const { capture, captured, outputBus } = setup()

    capture.startPendingReply(WS)
    outputBus.publish(RUN, '⏺ 好的，我已经把任务派给关羽了。\n')
    vi.advanceTimersByTime(FLUSH_MS + 1)

    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      direction: 'outbound',
      messageType: 'orch_reply',
      workspaceId: WS,
    })
    expect(captured[0]?.text).toContain('我已经把任务派给关羽了')
  })

  test('ignores orchestrator output when no mobile turn opened a capture window', () => {
    const { captured, outputBus } = setup()

    // Web-driven turn: startPendingReply was never called.
    outputBus.publish(RUN, '这是 web 端对话的输出，不应进手机 chat\n')
    vi.advanceTimersByTime(FLUSH_MS + 1)

    expect(captured).toHaveLength(0)
  })

  test('does not persist system messages / dispatch injections as a reply', () => {
    const { capture, captured, outputBus } = setup()

    capture.startPendingReply(WS)
    outputBus.publish(
      RUN,
      [
        '[Hive 系统消息：来自 @关羽 的汇报]',
        '---',
        '[来自手机 Mobile App] 用户的原始问题被回显',
        '</hive-system-reminder>',
        'Bash(git status)',
        '... thinking ...',
      ].join('\n')
    )
    vi.advanceTimersByTime(FLUSH_MS + 1)

    expect(captured).toHaveLength(0)
  })

  test('noteExplicitReply drops the in-flight buffer so team mobile-reply is not duplicated', () => {
    const { capture, captured, outputBus } = setup()

    capture.startPendingReply(WS)
    outputBus.publish(RUN, '⏺ 正在查询……\n')
    // Orchestrator then calls `team mobile-reply` — the public insert path notifies us.
    capture.noteExplicitReply(WS)
    vi.advanceTimersByTime(FLUSH_MS + 1)

    // The explicit reply is written by its own path; the capture must stay silent.
    expect(captured).toHaveLength(0)
  })

  test('a new mobile turn flushes the previous pending reply before opening the next window', () => {
    const { capture, captured, outputBus } = setup()

    capture.startPendingReply(WS)
    outputBus.publish(RUN, '⏺ 第一条回复。\n')
    // Next mobile message arrives before the flush timer fired.
    capture.startPendingReply(WS)

    expect(captured).toHaveLength(1)
    expect(captured[0]?.text).toContain('第一条回复')
  })
})
