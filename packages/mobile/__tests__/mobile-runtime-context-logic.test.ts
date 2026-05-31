import { describe, expect, test } from 'vitest'

import {
  shouldProbeForegroundReconnect,
  shouldQueuePromptBeforeSend,
} from '../src/api/mobile-runtime-context-logic.js'

describe('mobile runtime context reconnect and outbox decisions', () => {
  test('probes foreground connectivity only when the app was backgrounded and a token exists', () => {
    expect(
      shouldProbeForegroundReconnect({
        hasToken: true,
        isBackgrounded: true,
        isReconnecting: false,
        state: 'connected',
      })
    ).toBe(true)
    expect(
      shouldProbeForegroundReconnect({
        hasToken: true,
        isBackgrounded: false,
        isReconnecting: false,
        state: 'connected',
      })
    ).toBe(false)
    expect(
      shouldProbeForegroundReconnect({
        hasToken: false,
        isBackgrounded: true,
        isReconnecting: false,
        state: 'connected',
      })
    ).toBe(false)
    expect(
      shouldProbeForegroundReconnect({
        hasToken: true,
        isBackgrounded: true,
        isReconnecting: false,
        state: 'error',
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
})
