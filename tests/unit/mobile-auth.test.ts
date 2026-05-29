import Database from 'better-sqlite3'
import { afterEach, describe, expect, test } from 'vitest'

import { createMobileAuthStore, type MobileCapability } from '../../src/server/mobile-auth.js'
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
  test('creates permanent manual tokens and authenticates them', () => {
    const store = createStore()

    const created = store.createDeviceToken('Personal phone', ['read_dashboard'], 1_000)

    expect(created.token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    expect(created.device).toMatchObject({
      capabilities: ['read_dashboard'],
      created_at: 1_000,
      device_type: 'mobile',
      last_seen_at: null,
      name: 'Personal phone',
      revoked_at: null,
      source: 'manual',
    })
    expect(store.authenticateDevice(created.token, 2_000)).toMatchObject({
      id: created.device.id,
      last_seen_at: 2_000,
      source: 'manual',
    })
  })

  test('authenticates capabilities and rejects missing capability', () => {
    const store = createStore()
    const created = store.createDeviceToken('Read-only', ['read_dashboard'], 1_000)
    const device = store.authenticateDevice(created.token, 3_000)

    expect(() => store.requireCapability(device, 'read_dashboard')).not.toThrow()
    expect(() => store.requireCapability(device, 'send_prompt')).toThrow(
      'Missing mobile capability'
    )
  })

  test('revokes devices immediately and keeps non-revoked tokens valid across long inactivity', () => {
    const store = createStore()
    const created = store.createDeviceToken('Admin', ['admin_runtime'], 1_000)

    const revoked = store.revokeDevice(created.device.id, 3_000)
    expect(revoked.revoked_at).toBe(3_000)
    expect(() => store.authenticateDevice(created.token, 4_000)).toThrow('Mobile device revoked')

    const active = store.createDeviceToken('Second', ['read_dashboard'], 5_000)
    expect(store.authenticateDevice(active.token, 5_000 + 365 * 24 * 60 * 60 * 1000).id).toBe(
      active.device.id
    )
  })

  test('updates token name and capabilities', () => {
    const store = createStore()
    const created = store.createDeviceToken('Phone', ['read_dashboard'], 1_000)

    const updated = store.updateDevice(created.device.id, {
      capabilities: ['read_dashboard', 'send_prompt'] satisfies MobileCapability[],
      name: 'Renamed phone',
    })

    expect(updated.name).toBe('Renamed phone')
    expect(updated.capabilities).toEqual(['read_dashboard', 'send_prompt'])
    expect(store.listDevices().map((device) => device.id)).toContain(created.device.id)
  })

  test('rejects unknown capabilities at token creation time', () => {
    const store = createStore()

    expect(() =>
      store.createDeviceToken('Phone', ['read_dashboard', 'root_runtime' as MobileCapability])
    ).toThrow('Invalid mobile capability')
  })

  test('validateToken remains a boolean compatibility wrapper', () => {
    const store = createStore()
    const created = store.createDeviceToken('Phone', ['read_dashboard'])

    expect(store.validateToken(created.token)).toBe(true)
    store.revokeDevice(created.device.id, 3_000)
    expect(store.validateToken(created.token)).toBe(false)
    expect(store.validateToken('missing')).toBe(false)
  })

  test('hard deletes tokens', () => {
    const store = createStore()
    const created = store.createDeviceToken('Phone', ['read_dashboard'], 1_000)

    store.deleteDevice(created.device.id)

    expect(store.listDevices().map((device) => device.id)).not.toContain(created.device.id)
    expect(() => store.authenticateDevice(created.token, 3_000)).toThrow(
      'Invalid or missing mobile token'
    )
  })

  test('updates only provided token fields', () => {
    const store = createStore()
    const created = store.createDeviceToken('Phone', ['read_dashboard'], 1_000)

    const updated = store.updateDevice(created.device.id, { name: 'Only name' })

    expect(updated.name).toBe('Only name')
    expect(updated.capabilities).toEqual(['read_dashboard'])
  })

  test('stores and clears an Expo push token for an authenticated device', () => {
    const store = createStore()
    const created = store.createDeviceToken('Phone', ['read_dashboard'], 1_000)

    const registered = store.updatePushToken(created.device.id, 'ExponentPushToken[abc]')
    expect(registered.push_token).toBe('ExponentPushToken[abc]')
    expect(store.listDevices().find((device) => device.id === created.device.id)?.push_token).toBe(
      'ExponentPushToken[abc]'
    )

    store.clearPushToken('ExponentPushToken[abc]')
    expect(store.listDevices().find((device) => device.id === created.device.id)?.push_token).toBe(
      null
    )
  })
})
