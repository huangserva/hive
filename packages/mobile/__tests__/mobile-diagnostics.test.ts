import { describe, expect, test } from 'vitest'

import {
  appendConnectionEvent,
  buildConnectionDiagnosticsText,
  createInitialConnectionDiagnostics,
  type MobileConnectionDiagnostics,
  maskSecret,
  sanitizeRelayConfigForDiagnostics,
} from '../src/api/mobile-diagnostics.js'
import type { StoredRelayConfig } from '../src/lib/relay-config-store.js'

const relayConfig: StoredRelayConfig = {
  capabilities: ['read_dashboard'],
  daemon_public_key: 'daemon-public-key-secret',
  device_id: 'device-123456',
  device_keypair: {
    publicKey: 'device-public-key-secret',
    secretKey: 'device-secret-key-secret',
  },
  relay_auth_token: 'relay-auth-token-secret',
  relay_url: 'wss://relay.example.test',
  room_id: 'room-abc',
}

describe('mobile connection diagnostics', () => {
  test('masks secrets and never exposes relay keys or tokens', () => {
    expect(maskSecret('abcdef123456')).toBe('configured (...3456)')
    expect(maskSecret('abc')).toBe('configured')
    expect(maskSecret('')).toBe('not configured')

    const sanitized = sanitizeRelayConfigForDiagnostics(relayConfig, 'mobile-token-secret')

    expect(sanitized).toMatchObject({
      configured: true,
      device_id: 'device-123456',
      relay_url: 'wss://relay.example.test',
      room_id: 'room-abc',
      token: 'configured (...cret)',
    })
    expect(JSON.stringify(sanitized)).not.toContain('relay-auth-token-secret')
    expect(JSON.stringify(sanitized)).not.toContain('device-secret-key-secret')
    expect(JSON.stringify(sanitized)).not.toContain('daemon-public-key-secret')
    expect(JSON.stringify(sanitized)).not.toContain('mobile-token-secret')
  })

  test('keeps only the latest 30 connection events', () => {
    let diagnostics = createInitialConnectionDiagnostics()
    for (let i = 0; i < 35; i += 1) {
      diagnostics = appendConnectionEvent(diagnostics, {
        detail: `event-${i}`,
        type: 'test_event',
      })
    }

    expect(diagnostics.events).toHaveLength(30)
    expect(diagnostics.events[0]?.detail).toBe('event-5')
    expect(diagnostics.events.at(-1)?.detail).toBe('event-34')
  })

  test('formats a complete redacted diagnostics payload for copying', () => {
    const diagnostics: MobileConnectionDiagnostics = {
      ...createInitialConnectionDiagnostics(),
      connectionMode: 'relay',
      error: 'Relay connect timed out',
      host: '192.168.1.2:4010',
      lastLanAttempt: {
        durationMs: 4002,
        error: 'The operation was aborted',
        ok: false,
        path: '/api/mobile/runtime/status',
        ts: 1_700_000_000_000,
      },
      lastRelayResult: {
        error: 'Relay RPC failed',
        method: 'runtime.status',
        ok: false,
        status: 'error',
        ts: 1_700_000_001_000,
      },
      relay: sanitizeRelayConfigForDiagnostics(relayConfig, 'mobile-token-secret'),
      state: 'error',
    }
    const withEvent = appendConnectionEvent(diagnostics, {
      detail: 'close code=1006 reason=network',
      type: 'relay_socket_close',
    })

    const text = buildConnectionDiagnosticsText(withEvent)

    expect(text).toContain('state: error')
    expect(text).toContain('connectionMode: relay')
    expect(text).toContain('lastError: Relay connect timed out')
    expect(text).toContain('relay_url: wss://relay.example.test')
    expect(text).toContain('LAN: failed /api/mobile/runtime/status in 4002ms')
    expect(text).toContain('Relay: failed runtime.status status=error')
    expect(text).toContain('relay_socket_close')
    expect(text).not.toContain('mobile-token-secret')
    expect(text).not.toContain('relay-auth-token-secret')
  })
})
