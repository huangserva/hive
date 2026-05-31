import { describe, expect, test } from 'vitest'

import {
  shouldClearLoadedStateOnConnectFailure,
  shouldProbeForegroundReconnect,
  shouldQueuePromptBeforeSend,
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
})
