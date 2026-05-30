import { describe, expect, test } from 'vitest'

import { generateDeviceKeypair } from '../src/api/relay-device-keys'
import type { RelayPairingInput } from '../src/lib/connection-qr'
import { buildStoredRelayConfig, parseStoredRelayConfig } from '../src/lib/relay-config-store'

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
