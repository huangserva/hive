import { describe, expect, test } from 'vitest'

import { ALL_MOBILE_CAPABILITIES, parseConnectionQr } from '../src/lib/connection-qr'

describe('parseConnectionQr', () => {
  test('parses a LAN-only QR (host + token), no relay section', () => {
    const parsed = parseConnectionQr(JSON.stringify({ host: '192.168.1.5:4010', token: 'tok-1' }))
    expect(parsed).toEqual({ host: '192.168.1.5:4010', token: 'tok-1' })
    expect(parsed?.relay).toBeUndefined()
  })

  test('parses a relay QR with all relay fields', () => {
    const parsed = parseConnectionQr(
      JSON.stringify({
        capabilities: ['read_dashboard', 'send_prompt'],
        daemon_public_key: 'daemon-pub',
        daemon_signing_public_key: 'daemon-signing-pub',
        device_id: 'dev-42',
        host: '192.168.1.5:4010',
        relay_auth_token: 'relay-secret',
        relay_protocol_version: 2,
        relay_url: 'wss://relay.example.com',
        room_auth_token: 'room-secret',
        room_id: 'room-9',
        token: 'tok-1',
      })
    )
    expect(parsed?.host).toBe('192.168.1.5:4010')
    expect(parsed?.token).toBe('tok-1')
    expect(parsed?.relay).toEqual({
      capabilities: ['read_dashboard', 'send_prompt'],
      daemon_public_key: 'daemon-pub',
      daemon_signing_public_key: 'daemon-signing-pub',
      device_id: 'dev-42',
      relay_auth_token: 'relay-secret',
      relay_protocol_version: 2,
      relay_url: 'wss://relay.example.com',
      room_auth_token: 'room-secret',
      room_id: 'room-9',
    })
  })

  test('parses legacy v1 relay QR without v2 fields during the compatibility window', () => {
    const parsed = parseConnectionQr(
      JSON.stringify({
        daemon_public_key: 'daemon-pub',
        device_id: 'dev-42',
        host: 'h:1',
        relay_auth_token: 'secret',
        relay_url: 'wss://r',
        room_id: 'room',
        token: 'tok',
      })
    )

    expect(parsed?.relay).toMatchObject({
      daemon_public_key: 'daemon-pub',
      relay_auth_token: 'secret',
      relay_protocol_version: 1,
    })
  })

  test('falls back to all capabilities when relay QR omits capabilities', () => {
    const parsed = parseConnectionQr(
      JSON.stringify({
        daemon_public_key: 'daemon-pub',
        device_id: 'dev-42',
        host: 'h:1',
        relay_auth_token: 'secret',
        relay_url: 'wss://r',
        room_id: 'room',
        token: 'tok',
      })
    )
    expect(parsed?.relay?.capabilities).toEqual(ALL_MOBILE_CAPABILITIES)
  })

  test('drops the relay section entirely when a required relay field is missing', () => {
    // relay_auth_token missing → must NOT produce a half-built relay config.
    const parsed = parseConnectionQr(
      JSON.stringify({
        daemon_public_key: 'daemon-pub',
        device_id: 'dev-42',
        host: 'h:1',
        relay_url: 'wss://r',
        room_id: 'room',
        token: 'tok',
      })
    )
    expect(parsed).toEqual({ host: 'h:1', token: 'tok' })
    expect(parsed?.relay).toBeUndefined()
  })

  test('returns null for malformed input', () => {
    expect(parseConnectionQr('not json')).toBeNull()
    expect(parseConnectionQr(JSON.stringify({ host: 'h' }))).toBeNull()
  })
})
