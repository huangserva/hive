import { describe, expect, test, vi } from 'vitest'

import {
  createDashboardSocketHandlers,
  nextChatSince,
  resetChatRuntimeForDisconnect,
  shouldApplyChatMessagesForWorkspace,
  shouldClearLoadedStateOnConnectFailure,
  shouldFlushQueuedOutbox,
  shouldProbeForegroundReconnect,
  shouldQueuePromptBeforeSend,
  shouldResetChatForConnectionSwitch,
  shouldResetChatForWorkspaceSwitch,
  shouldResetLanCooldownBeforeForegroundProbe,
} from '../src/api/mobile-runtime-context-logic.js'

describe('mobile runtime context reconnect and outbox decisions', () => {
  test('probes foreground connectivity only when the app was backgrounded and a token exists', () => {
    expect(
      shouldProbeForegroundReconnect({
        connectionMode: 'lan',
        preferredConnectionMode: 'auto',
        hasToken: true,
        isBackgrounded: true,
        isReconnecting: false,
        state: 'connected',
      })
    ).toBe(true)
    expect(
      shouldProbeForegroundReconnect({
        connectionMode: 'lan',
        preferredConnectionMode: 'auto',
        hasToken: true,
        isBackgrounded: false,
        isReconnecting: false,
        state: 'connected',
      })
    ).toBe(false)
    expect(
      shouldProbeForegroundReconnect({
        connectionMode: 'lan',
        preferredConnectionMode: 'auto',
        hasToken: false,
        isBackgrounded: true,
        isReconnecting: false,
        state: 'connected',
      })
    ).toBe(false)
    expect(
      shouldProbeForegroundReconnect({
        connectionMode: 'lan',
        preferredConnectionMode: 'auto',
        hasToken: true,
        isBackgrounded: true,
        isReconnecting: false,
        state: 'error',
      })
    ).toBe(false)
  })

  test('foreground reconnect should clear LAN cooldown only when relay is currently preferred', () => {
    expect(
      shouldResetLanCooldownBeforeForegroundProbe({
        connectionMode: 'relay',
        preferredConnectionMode: 'auto',
        hasToken: true,
        isBackgrounded: true,
        isReconnecting: false,
        state: 'connected',
      })
    ).toBe(true)
    expect(
      shouldResetLanCooldownBeforeForegroundProbe({
        connectionMode: 'lan',
        preferredConnectionMode: 'auto',
        hasToken: true,
        isBackgrounded: true,
        isReconnecting: false,
        state: 'connected',
      })
    ).toBe(false)
    expect(
      shouldResetLanCooldownBeforeForegroundProbe({
        connectionMode: 'relay',
        preferredConnectionMode: 'relay',
        hasToken: true,
        isBackgrounded: true,
        isReconnecting: false,
        state: 'connected',
      })
    ).toBe(false)
  })

  test('queues prompts instead of sending them while reconnecting or disconnected', () => {
    expect(
      shouldQueuePromptBeforeSend({
        connectionMode: 'relay',
        connectionState: 'connected',
        reconnecting: false,
        relayTransportReady: true,
      })
    ).toBe(false)
    expect(
      shouldQueuePromptBeforeSend({
        connectionMode: 'relay',
        connectionState: 'connected',
        reconnecting: true,
        relayTransportReady: true,
      })
    ).toBe(true)
    expect(
      shouldQueuePromptBeforeSend({
        connectionMode: 'relay',
        connectionState: 'error',
        reconnecting: false,
        relayTransportReady: true,
      })
    ).toBe(true)
    // relay 模式 + relay 未 ready → queue（等 relay ready）。
    expect(
      shouldQueuePromptBeforeSend({
        connectionMode: 'relay',
        connectionState: 'connected',
        reconnecting: false,
        relayTransportReady: false,
      })
    ).toBe(true)
  })

  // P0 复现：LAN 模式 + relay 永远 not ready + connected + 不 reconnecting → **绝不能 queue**。
  // 旧逻辑（无条件 !relayTransportReady）会返回 true → 每条 prompt 卡队列、永不发出（DB 零 inbound）。
  // 这条退回旧逻辑必红。
  test('does NOT queue in LAN mode even when relay transport is not ready (P0 regression)', () => {
    expect(
      shouldQueuePromptBeforeSend({
        connectionMode: 'lan',
        connectionState: 'connected',
        reconnecting: false,
        relayTransportReady: false,
      })
    ).toBe(false)
  })

  test('relay-readiness gate only applies to relay mode (lan/disconnected ignore it)', () => {
    // lan：relay 未 ready 照发。
    expect(
      shouldQueuePromptBeforeSend({
        connectionMode: 'lan',
        connectionState: 'connected',
        reconnecting: false,
        relayTransportReady: false,
      })
    ).toBe(false)
    // disconnected 连接模式（但 state=connected）：同样不被 relay 门槛卡。
    expect(
      shouldQueuePromptBeforeSend({
        connectionMode: 'disconnected',
        connectionState: 'connected',
        reconnecting: false,
        relayTransportReady: false,
      })
    ).toBe(false)
    // 但 lan 模式下仍尊重 state/reconnecting。
    expect(
      shouldQueuePromptBeforeSend({
        connectionMode: 'lan',
        connectionState: 'connected',
        reconnecting: true,
        relayTransportReady: true,
      })
    ).toBe(true)
    expect(
      shouldQueuePromptBeforeSend({
        connectionMode: 'lan',
        connectionState: 'error',
        reconnecting: false,
        relayTransportReady: true,
      })
    ).toBe(true)
    // relay 模式 ready → 不 queue（确认 relay 正常路不受影响）。
    expect(
      shouldQueuePromptBeforeSend({
        connectionMode: 'relay',
        connectionState: 'connected',
        reconnecting: false,
        relayTransportReady: true,
      })
    ).toBe(false)
  })

  // dispatch 8855a45c 修复3：flush 队列门槛。基线（lan/relay-ready）正常 flush。
  test('flushes queued outbox when connected, not reconnecting, and relay (if used) is ready', () => {
    expect(
      shouldFlushQueuedOutbox({
        connectionMode: 'relay',
        connectionState: 'connected',
        reconnecting: false,
        queuedCount: 2,
        relayTransportReady: true,
      })
    ).toBe(true)
    expect(
      shouldFlushQueuedOutbox({
        connectionMode: 'lan',
        connectionState: 'connected',
        reconnecting: false,
        queuedCount: 1,
        relayTransportReady: false, // lan 不用 relay，门槛不卡
      })
    ).toBe(true)
  })

  // 核心：relay 模式 + relay transport 未 ready（churn/重连中途）→ 绝不 flush（否则 flush RPC 撞超时、
  // 再喂 churn）。退回"无 relay-ready 门槛"必红。
  test('does NOT flush in relay mode while the relay transport is not ready (Fix3)', () => {
    expect(
      shouldFlushQueuedOutbox({
        connectionMode: 'relay',
        connectionState: 'connected',
        reconnecting: false,
        queuedCount: 3,
        relayTransportReady: false,
      })
    ).toBe(false)
  })

  test('does NOT flush when disconnected, reconnecting, or the queue is empty', () => {
    expect(
      shouldFlushQueuedOutbox({
        connectionMode: 'relay',
        connectionState: 'error',
        reconnecting: false,
        queuedCount: 2,
        relayTransportReady: true,
      })
    ).toBe(false)
    expect(
      shouldFlushQueuedOutbox({
        connectionMode: 'lan',
        connectionState: 'connected',
        reconnecting: true,
        queuedCount: 2,
        relayTransportReady: true,
      })
    ).toBe(false)
    expect(
      shouldFlushQueuedOutbox({
        connectionMode: 'relay',
        connectionState: 'connected',
        reconnecting: false,
        queuedCount: 0,
        relayTransportReady: true,
      })
    ).toBe(false)
  })

  // M 修复：chatSince 单调推进，防 relay 乱序/更早推送让 since 倒退重复拉旧消息。
  test('nextChatSince advances to the newest created_at and never regresses', () => {
    // 从 undefined 起：取本批最大。
    expect(
      nextChatSince(undefined, [{ created_at: 10 }, { created_at: 30 }, { created_at: 20 }])
    ).toBe(30)
    // 更新的消息 → 前进。
    expect(nextChatSince(30, [{ created_at: 45 }])).toBe(45)
    // relay 推来比 since 更早的消息 → 绝不后退（保持 30）。
    expect(nextChatSince(30, [{ created_at: 5 }, { created_at: 12 }])).toBe(30)
    // 乱序批次里只要有更大的就推进到那个最大值。
    expect(nextChatSince(30, [{ created_at: 5 }, { created_at: 99 }, { created_at: 7 }])).toBe(99)
    // 空批 → 不动。
    expect(nextChatSince(30, [])).toBe(30)
    expect(nextChatSince(undefined, [])).toBeUndefined()
  })

  // BLOCKING 修复：dashboard WebSocket 的 message/error/close 都必须先过 workspace 到达时守卫。
  // 切走后旧 socket 的事件不得 onDisconnected(setError/setState/scheduleReconnect) 或 onDashboard 污染当前。
  describe('createDashboardSocketHandlers workspace guard', () => {
    const build = (currentWorkspaceId: () => string | null, connected = true, closing = false) => {
      const onDashboard = vi.fn()
      const onParseError = vi.fn()
      const onDisconnected = vi.fn()
      const handlers = createDashboardSocketHandlers({
        socketWorkspaceId: 'A',
        currentWorkspaceId,
        isClosing: () => closing,
        isConnected: () => connected,
        onDashboard,
        onParseError,
        onDisconnected,
      })
      return { handlers, onDashboard, onParseError, onDisconnected }
    }

    test('acts on events while the socket workspace is still current', () => {
      const { handlers, onDashboard, onDisconnected } = build(() => 'A')
      handlers.handleMessage(
        JSON.stringify({ kind: 'mobile-dashboard-update', payload: { ok: true } })
      )
      expect(onDashboard).toHaveBeenCalledWith({ ok: true })
      handlers.handleError()
      handlers.handleClose()
      expect(onDisconnected).toHaveBeenCalledTimes(2)
    })

    test('ignores message/error/close from a socket whose workspace is no longer current', () => {
      // 切到 B：socketWorkspaceId='A' 已 stale。
      const { handlers, onDashboard, onParseError, onDisconnected } = build(() => 'B')
      handlers.handleMessage(
        JSON.stringify({ kind: 'mobile-dashboard-update', payload: { ok: true } })
      )
      handlers.handleError()
      handlers.handleClose()
      expect(onDashboard).not.toHaveBeenCalled()
      expect(onParseError).not.toHaveBeenCalled()
      expect(onDisconnected).not.toHaveBeenCalled() // 不 setError/setState/scheduleReconnect
    })

    test('close does not fire onDisconnected when closing or not connected', () => {
      expect(build(() => 'A', true, true).onDisconnected).toBeDefined()
      const closingCase = build(() => 'A', true, true)
      closingCase.handlers.handleClose()
      expect(closingCase.onDisconnected).not.toHaveBeenCalled() // closing=true（effect cleanup 主动关）
      const notConnected = build(() => 'A', false, false)
      notConnected.handlers.handleClose()
      expect(notConnected.onDisconnected).not.toHaveBeenCalled() // 非 connected 态不重连
    })
  })

  test('keeps the last loaded dashboard on reconnect failures once it exists', () => {
    expect(shouldClearLoadedStateOnConnectFailure(false)).toBe(true)
    expect(shouldClearLoadedStateOnConnectFailure(true)).toBe(false)
  })

  test('resets chat immediately when switching to a different workspace', () => {
    expect(
      shouldResetChatForWorkspaceSwitch({
        currentWorkspaceId: 'workspace-old',
        nextWorkspaceId: 'workspace-new',
      })
    ).toBe(true)
    expect(
      shouldResetChatForWorkspaceSwitch({
        currentWorkspaceId: 'workspace-new',
        nextWorkspaceId: 'workspace-new',
      })
    ).toBe(false)
  })

  test('drops chat fetch results that return after the user switched workspaces', () => {
    expect(
      shouldApplyChatMessagesForWorkspace({
        currentWorkspaceId: 'workspace-new',
        requestedWorkspaceId: 'workspace-old',
      })
    ).toBe(false)
    expect(
      shouldApplyChatMessagesForWorkspace({
        currentWorkspaceId: 'workspace-new',
        requestedWorkspaceId: 'workspace-new',
      })
    ).toBe(true)
  })

  test('disconnect reset blocks late chat fetches from the old workspace', () => {
    const disconnectReset = resetChatRuntimeForDisconnect()

    expect(disconnectReset.selectedWorkspaceId).toBeNull()
    expect(disconnectReset.chatSince).toBeUndefined()
    expect(disconnectReset.shouldClearMessages).toBe(true)
    expect(
      shouldApplyChatMessagesForWorkspace({
        currentWorkspaceId: disconnectReset.selectedWorkspaceId,
        requestedWorkspaceId: 'workspace-old',
      })
    ).toBe(false)
  })

  test('resets chat when reconnecting to a different host or token', () => {
    expect(
      shouldResetChatForConnectionSwitch({
        currentHost: 'http://192.168.1.2:4010',
        currentToken: 'token-a',
        nextHost: 'http://10.0.0.2:4010',
        nextToken: 'token-a',
      })
    ).toBe(true)
    expect(
      shouldResetChatForConnectionSwitch({
        currentHost: 'http://192.168.1.2:4010',
        currentToken: 'token-a',
        nextHost: 'http://192.168.1.2:4010',
        nextToken: 'token-b',
      })
    ).toBe(true)
    expect(
      shouldResetChatForConnectionSwitch({
        currentHost: 'http://192.168.1.2:4010',
        currentToken: 'token-a',
        nextHost: 'http://192.168.1.2:4010',
        nextToken: 'token-a',
      })
    ).toBe(false)
  })
})
