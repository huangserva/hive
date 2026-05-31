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

  test('does NOT auto-capture orchestrator PTY output — auto-reply-capture is disabled', () => {
    const { capture, captured, outputBus } = setup()

    // startPendingReply is a no-op (reverted): raw PTY output is garbage (system
    // reminders, thinking, paste markers) and must never be posted as a reply.
    capture.startPendingReply(WS)
    outputBus.publish(RUN, '⏺ 好的，我已经把任务派给关羽了。\n')
    vi.advanceTimersByTime(FLUSH_MS + 1)

    // Nothing captured: orchestrator replies reach mobile chat only via the
    // explicit `team mobile-reply` command.
    expect(captured).toHaveLength(0)
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

  test('repeated startPendingReply calls never capture output (no-op)', () => {
    const { capture, captured, outputBus } = setup()

    capture.startPendingReply(WS)
    outputBus.publish(RUN, '⏺ 第一条回复。\n')
    capture.startPendingReply(WS)
    vi.advanceTimersByTime(FLUSH_MS + 1)

    // No capture windows open → no garbage reply, regardless of repeated turns.
    expect(captured).toHaveLength(0)
  })
})
