import Database from 'better-sqlite3'
import { afterEach, describe, expect, test } from 'vitest'

import {
  createMobileAuthStore,
  MOBILE_CAPABILITIES,
  type MobileCapability,
} from '../../src/server/mobile-auth.js'
import { initializeRuntimeDatabase } from '../../src/server/sqlite-schema.js'

let db: Database | null = null

afterEach(() => {
  db?.close()
  db = null
})

const createStore = () => {
  db = new Database(':memory:')
  initializeRuntimeDatabase(db)
  return createMobileAuthStore(db)
}

describe('mobile auth store', () => {
  test('migrates the default M19a device to a fully capable legacy device', () => {
    const store = createStore()
    const device = store.ensureDefaultDevice()

    expect(device.device_type).toBe('legacy_m19a')
    expect(device.revoked_at).toBeNull()
    expect(device.capabilities).toEqual([...MOBILE_CAPABILITIES])
  })

  test('generates and redeems a one-time pairing code', () => {
    const store = createStore()
    const pairing = store.generatePairingCode('Alice iPhone', ['read_dashboard'], 300_000, 1_000)

    expect(pairing.code).toMatch(/^\d{6}$/)
    expect(pairing.expires_at).toBe(301_000)

    const redeemed = store.redeemPairingCode(pairing.code, 2_000)
    expect(redeemed.token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    expect(redeemed.device.name).toBe('Alice iPhone')
    expect(redeemed.device.capabilities).toEqual(['read_dashboard'])
    expect(redeemed.device.device_type).toBe('mobile')
  })

  test('rejects expired and already redeemed pairing codes', () => {
    const store = createStore()
    const expired = store.generatePairingCode('Old phone', ['read_dashboard'], 100, 1_000)
    expect(() => store.redeemPairingCode(expired.code, 1_101)).toThrow('Pairing code expired')

    const fresh = store.generatePairingCode('New phone', ['read_dashboard'], 300_000, 2_000)
    store.redeemPairingCode(fresh.code, 3_000)
    expect(() => store.redeemPairingCode(fresh.code, 4_000)).toThrow(
      'Pairing code already redeemed'
    )
  })

  test('authenticates capabilities and rejects missing capability', () => {
    const store = createStore()
    const pairing = store.generatePairingCode('Read-only', ['read_dashboard'], 300_000, 1_000)
    const redeemed = store.redeemPairingCode(pairing.code, 2_000)
    const device = store.authenticateDevice(redeemed.token, 3_000)

    expect(device.id).toBe(redeemed.device.id)
    expect(() => store.requireCapability(device, 'read_dashboard')).not.toThrow()
    expect(() => store.requireCapability(device, 'send_prompt')).toThrow(
      'Missing mobile capability'
    )
  })

  test('revokes devices immediately and expires inactive devices after 30 days', () => {
    const store = createStore()
    const pairing = store.generatePairingCode('Admin', ['admin_runtime'], 300_000, 1_000)
    const redeemed = store.redeemPairingCode(pairing.code, 2_000)

    const revoked = store.revokeDevice(redeemed.device.id, 3_000)
    expect(revoked.revoked_at).toBe(3_000)
    expect(() => store.authenticateDevice(redeemed.token, 4_000)).toThrow('Mobile device revoked')

    const second = store.generatePairingCode('Second', ['read_dashboard'], 300_000, 5_000)
    const active = store.redeemPairingCode(second.code, 6_000)
    expect(() => store.authenticateDevice(active.token, 6_000 + 31 * 24 * 60 * 60 * 1000)).toThrow(
      'Mobile token expired'
    )
  })

  test('updates device name and capabilities', () => {
    const store = createStore()
    const pairing = store.generatePairingCode('Phone', ['read_dashboard'], 300_000, 1_000)
    const redeemed = store.redeemPairingCode(pairing.code, 2_000)

    const updated = store.updateDevice(redeemed.device.id, {
      capabilities: ['read_dashboard', 'send_prompt'] satisfies MobileCapability[],
      name: 'Renamed phone',
    })

    expect(updated.name).toBe('Renamed phone')
    expect(updated.capabilities).toEqual(['read_dashboard', 'send_prompt'])
    expect(store.listDevices().map((device) => device.id)).toContain(redeemed.device.id)
  })

  test('rejects invalid pairing codes', () => {
    const store = createStore()

    expect(() => store.redeemPairingCode('000000', 1_000)).toThrow('Invalid pairing code')
  })

  test('rejects unknown capabilities at code generation time', () => {
    const store = createStore()

    expect(() =>
      store.generatePairingCode('Phone', ['read_dashboard', 'root_runtime' as MobileCapability])
    ).toThrow('Invalid mobile capability')
  })

  test('validateToken remains a boolean compatibility wrapper', () => {
    const store = createStore()
    const pairing = store.generatePairingCode('Phone', ['read_dashboard'])
    const redeemed = store.redeemPairingCode(pairing.code)

    expect(store.validateToken(redeemed.token)).toBe(true)
    store.revokeDevice(redeemed.device.id, 3_000)
    expect(store.validateToken(redeemed.token)).toBe(false)
    expect(store.validateToken('missing')).toBe(false)
  })

  test('lists revoked devices for registry management', () => {
    const store = createStore()
    const pairing = store.generatePairingCode('Phone', ['admin_runtime'], 300_000, 1_000)
    const redeemed = store.redeemPairingCode(pairing.code, 2_000)
    store.revokeDevice(redeemed.device.id, 3_000)

    expect(store.listDevices().find((device) => device.id === redeemed.device.id)?.revoked_at).toBe(
      3_000
    )
  })

  test('cleans expired pairing codes before generating new codes', () => {
    const store = createStore()
    const expired = store.generatePairingCode('Old', ['read_dashboard'], 100, 1_000)
    store.generatePairingCode('New', ['read_dashboard'], 300_000, 1_101)

    expect(() => store.redeemPairingCode(expired.code, 1_102)).toThrow('Invalid pairing code')
  })

  test('updates only provided device fields', () => {
    const store = createStore()
    const pairing = store.generatePairingCode('Phone', ['read_dashboard'], 300_000, 1_000)
    const redeemed = store.redeemPairingCode(pairing.code, 2_000)

    const updated = store.updateDevice(redeemed.device.id, { name: 'Only name' })

    expect(updated.name).toBe('Only name')
    expect(updated.capabilities).toEqual(['read_dashboard'])
  })

  test('stores and clears an Expo push token for an authenticated device', () => {
    const store = createStore()
    const pairing = store.generatePairingCode('Phone', ['read_dashboard'], 300_000, 1_000)
    const redeemed = store.redeemPairingCode(pairing.code, 2_000)

    const registered = store.updatePushToken(redeemed.device.id, 'ExponentPushToken[abc]')
    expect(registered.push_token).toBe('ExponentPushToken[abc]')
    expect(store.listDevices().find((device) => device.id === redeemed.device.id)?.push_token).toBe(
      'ExponentPushToken[abc]'
    )

    store.clearPushToken('ExponentPushToken[abc]')
    expect(store.listDevices().find((device) => device.id === redeemed.device.id)?.push_token).toBe(
      null
    )
  })
})
