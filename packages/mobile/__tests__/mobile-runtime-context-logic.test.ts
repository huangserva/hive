import { describe, expect, test } from 'vitest'

import {
  resetChatRuntimeForDisconnect,
  shouldApplyChatMessagesForWorkspace,
  shouldClearLoadedStateOnConnectFailure,
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
        connectionState: 'connected',
        reconnecting: false,
        relayTransportReady: true,
      })
    ).toBe(false)
    expect(
      shouldQueuePromptBeforeSend({
        connectionState: 'connected',
        reconnecting: true,
        relayTransportReady: true,
      })
    ).toBe(true)
    expect(
      shouldQueuePromptBeforeSend({
        connectionState: 'error',
        reconnecting: false,
        relayTransportReady: true,
      })
    ).toBe(true)
    expect(
      shouldQueuePromptBeforeSend({
        connectionState: 'connected',
        reconnecting: false,
        relayTransportReady: false,
      })
    ).toBe(true)
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
