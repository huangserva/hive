import { describe, expect, test } from 'vitest'

import { generateDeviceKeypair } from '../src/api/relay-device-keys'
import type { RelayPairingInput } from '../src/lib/connection-qr'
import {
  buildStoredRelayConfig,
  normalizeRelayUrl,
  parseStoredRelayConfig,
  parseStoredRelayConfigWithMigration,
} from '../src/lib/relay-config-store'

const pairing: RelayPairingInput = {
  capabilities: ['read_dashboard', 'admin_runtime'],
  daemon_public_key: 'daemon-pub',
  device_id: 'dev-1',
  relay_auth_token: 'relay-secret',
  relay_url: 'wss://relay.example.com',
  room_id: 'room-1',
}

describe('relay config store', () => {
  test('generateDeviceKeypair returns a base64 NaCl box keypair', () => {
    const kp = generateDeviceKeypair()
    expect(kp.publicKey).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(kp.secretKey).toMatch(/^[A-Za-z0-9+/]+=*$/)
    // distinct keys, and not the same value
    expect(kp.publicKey).not.toBe(kp.secretKey)
    expect(generateDeviceKeypair().secretKey).not.toBe(kp.secretKey)
  })

  test('build → stringify → parse round-trips into an equal, valid config', () => {
    const keypair = generateDeviceKeypair()
    const built = buildStoredRelayConfig(pairing, keypair)
    expect(built.device_keypair).toEqual(keypair)
    expect(built.device_id).toBe('dev-1')

    const reparsed = parseStoredRelayConfig(JSON.stringify(built))
    expect(reparsed).toEqual(built)
  })

  test('normalizes legacy dmit relay urls to aliyun while preserving url parts', () => {
    expect(normalizeRelayUrl('wss://dmit.servasyy.com:9443/relay/ws?room=1#frag')).toBe(
      'wss://aliyun.servasyy.com:9443/relay/ws?room=1#frag'
    )
  })

  test('buildStoredRelayConfig migrates scanned or manual legacy relay url before storing', () => {
    const keypair = generateDeviceKeypair()
    const built = buildStoredRelayConfig(
      { ...pairing, relay_url: 'wss://dmit.servasyy.com/relay?room=1' },
      keypair
    )

    expect(built.relay_url).toBe('wss://aliyun.servasyy.com/relay?room=1')
  })

  test('parseStoredRelayConfig migrates stored legacy relay url', () => {
    const built = buildStoredRelayConfig(pairing, generateDeviceKeypair())
    const stored = JSON.stringify({ ...built, relay_url: 'wss://dmit.servasyy.com/ws' })

    expect(parseStoredRelayConfig(stored)?.relay_url).toBe('wss://aliyun.servasyy.com/ws')
    expect(parseStoredRelayConfigWithMigration(stored)?.migrated).toBe(true)
  })

  test('parseStoredRelayConfig rejects a config missing the device keypair', () => {
    const built = buildStoredRelayConfig(pairing, generateDeviceKeypair())
    const broken = { ...built, device_keypair: undefined }
    expect(parseStoredRelayConfig(JSON.stringify(broken))).toBeNull()
  })

  test('parseStoredRelayConfig rejects a config missing relay_auth_token', () => {
    const built = buildStoredRelayConfig(pairing, generateDeviceKeypair())
    const broken: Record<string, unknown> = { ...built }
    broken.relay_auth_token = undefined
    expect(parseStoredRelayConfig(JSON.stringify(broken))).toBeNull()
  })

  test('parseStoredRelayConfig returns null for null / malformed input', () => {
    expect(parseStoredRelayConfig(null)).toBeNull()
    expect(parseStoredRelayConfig('{ not json')).toBeNull()
  })
})
