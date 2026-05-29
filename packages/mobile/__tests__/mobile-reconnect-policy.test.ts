import { describe, expect, test } from 'vitest'

import {
  nextReconnectDelayMs,
  shouldAttemptAutoReconnect,
} from '../src/api/mobile-reconnect-policy.js'

describe('mobile reconnect policy', () => {
  test('backs off failed reconnect attempts with an upper bound', () => {
    expect(nextReconnectDelayMs(0)).toBe(3000)
    expect(nextReconnectDelayMs(1)).toBe(6000)
    expect(nextReconnectDelayMs(2)).toBe(12_000)
    expect(nextReconnectDelayMs(10)).toBe(30_000)
  })

  test('only retries when a saved token exists and no reconnect is in flight', () => {
    expect(
      shouldAttemptAutoReconnect({
        demoMode: false,
        hasToken: true,
        inFlight: false,
        state: 'error',
      })
    ).toBe(true)
    expect(
      shouldAttemptAutoReconnect({
        demoMode: false,
        hasToken: false,
        inFlight: false,
        state: 'error',
      })
    ).toBe(false)
    expect(
      shouldAttemptAutoReconnect({
        demoMode: false,
        hasToken: true,
        inFlight: true,
        state: 'error',
      })
    ).toBe(false)
    expect(
      shouldAttemptAutoReconnect({
        demoMode: false,
        hasToken: true,
        inFlight: false,
        state: 'connected',
      })
    ).toBe(false)
  })
})
