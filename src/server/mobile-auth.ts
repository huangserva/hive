import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

import type { Database } from 'better-sqlite3'

import { BadRequestError, ForbiddenError, HttpError, UnauthorizedError } from './http-errors.js'

export const MOBILE_CAPABILITIES = [
  'read_dashboard',
  'read_terminal',
  'send_prompt',
  'approve_risk',
  'admin_runtime',
] as const

export type MobileCapability = (typeof MOBILE_CAPABILITIES)[number]

const LEGACY_M19A_CAPABILITIES: MobileCapability[] = [...MOBILE_CAPABILITIES]
const DEFAULT_PAIRING_EXPIRES_IN_MS = 5 * 60 * 1000
const INACTIVE_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface MobileDeviceRecord {
  capabilities: MobileCapability[]
  created_at: number
  device_type: string | null
  id: string
  last_seen_at: number | null
  name: string
  revoked_at: number | null
  token: string
}

interface MobileDeviceRow {
  capabilities: string | null
  created_at: number
  device_type: string | null
  id: string
  last_seen_at: number | null
  name: string
  revoked_at: number | null
  token: string
}

export interface MobilePairingCodeRecord {
  capabilities: MobileCapability[]
  code: string
  device_name: string
  expires_at: number
}

export interface MobileAuthStore {
  authenticateDevice: (token: string | undefined, now?: number) => MobileDeviceRecord
  ensureDefaultDevice: () => MobileDeviceRecord
  generatePairingCode: (
    deviceName: string,
    capabilities: MobileCapability[],
    expiresInMs?: number,
    now?: number
  ) => MobilePairingCodeRecord
  listDevices: () => MobileDeviceRecord[]
  redeemPairingCode: (code: string, now?: number) => { device: MobileDeviceRecord; token: string }
  requireCapability: (device: MobileDeviceRecord, capability: MobileCapability) => void
  revokeDevice: (deviceId: string, now?: number) => MobileDeviceRecord
  updateDevice: (
    deviceId: string,
    patch: { capabilities?: MobileCapability[]; name?: string }
  ) => MobileDeviceRecord
  validateToken: (token: string | undefined) => boolean
}

const generateMobileToken = () => randomBytes(32).toString('base64url')

const generatePairingCodeValue = () => String(randomInt(0, 1_000_000)).padStart(6, '0')

const parseCapabilities = (value: string | null): MobileCapability[] => {
  if (!value) return []
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed)) return []
  return normalizeCapabilities(parsed)
}

const normalizeCapabilities = (value: unknown[]): MobileCapability[] => {
  const allowed = new Set<string>(MOBILE_CAPABILITIES)
  const next: MobileCapability[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.has(item)) {
      throw new BadRequestError(`Invalid mobile capability: ${String(item)}`)
    }
    if (!next.includes(item as MobileCapability)) next.push(item as MobileCapability)
  }
  return next
}

const mapDeviceRow = (row: MobileDeviceRow): MobileDeviceRecord => ({
  capabilities: parseCapabilities(row.capabilities),
  created_at: row.created_at,
  device_type: row.device_type,
  id: row.id,
  last_seen_at: row.last_seen_at,
  name: row.name,
  revoked_at: row.revoked_at,
  token: row.token,
})

export const extractMobileToken = (request: IncomingMessage) => {
  const value = Array.isArray(request.headers.authorization)
    ? request.headers.authorization[0]
    : request.headers.authorization
  if (!value) return undefined
  return /^Bearer\s+(.+)$/i.exec(value)?.[1]
}

export const requireMobileDeviceFromRequest = (
  request: IncomingMessage,
  authenticateDevice: (token: string | undefined) => MobileDeviceRecord
) => authenticateDevice(extractMobileToken(request))

export const requireMobileCapabilityFromRequest = (
  request: IncomingMessage,
  store: Pick<MobileAuthStore, 'authenticateDevice' | 'requireCapability'>,
  capability: MobileCapability
) => {
  const device = store.authenticateDevice(extractMobileToken(request))
  store.requireCapability(device, capability)
  return device
}

export const requireMobileTokenFromRequest = (
  request: IncomingMessage,
  validateToken: (token: string | undefined) => boolean
) => {
  const token = extractMobileToken(request)
  if (!validateToken(token)) {
    throw new UnauthorizedError('Invalid or missing mobile token')
  }
}

export const createMobileAuthStore = (db: Database): MobileAuthStore => {
  const selectDefault = db.prepare(
    'SELECT id, token, name, capabilities, device_type, revoked_at, created_at, last_seen_at FROM mobile_devices ORDER BY created_at ASC LIMIT 1'
  )
  const insertDevice = db.prepare(
    `INSERT INTO mobile_devices (
      id,
      token,
      name,
      capabilities,
      device_type,
      revoked_at,
      created_at,
      last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const selectByToken = db.prepare(
    'SELECT id, token, name, capabilities, device_type, revoked_at, created_at, last_seen_at FROM mobile_devices WHERE token = ?'
  )
  const selectById = db.prepare(
    'SELECT id, token, name, capabilities, device_type, revoked_at, created_at, last_seen_at FROM mobile_devices WHERE id = ?'
  )
  const touchByToken = db.prepare('UPDATE mobile_devices SET last_seen_at = ? WHERE token = ?')
  const cleanupExpiredCodes = db.prepare(
    'DELETE FROM mobile_pairing_codes WHERE expires_at <= ? OR redeemed_at IS NOT NULL'
  )
  const insertPairingCode = db.prepare(
    'INSERT INTO mobile_pairing_codes (code, device_name, capabilities, expires_at) VALUES (?, ?, ?, ?)'
  )
  const selectPairingCode = db.prepare(
    'SELECT code, device_name, capabilities, expires_at, redeemed_at FROM mobile_pairing_codes WHERE code = ?'
  )
  const redeemPairingCode = db.prepare(
    'UPDATE mobile_pairing_codes SET redeemed_at = ?, redeemed_device_id = ? WHERE code = ?'
  )
  const selectDevices = db.prepare(
    'SELECT id, token, name, capabilities, device_type, revoked_at, created_at, last_seen_at FROM mobile_devices ORDER BY created_at ASC'
  )
  const updateRevokedAt = db.prepare('UPDATE mobile_devices SET revoked_at = ? WHERE id = ?')
  const updateName = db.prepare('UPDATE mobile_devices SET name = ? WHERE id = ?')
  const updateCapabilities = db.prepare('UPDATE mobile_devices SET capabilities = ? WHERE id = ?')

  const getDeviceById = (deviceId: string) => {
    const row = selectById.get(deviceId) as MobileDeviceRow | undefined
    if (!row) throw new BadRequestError(`Mobile device not found: ${deviceId}`)
    return mapDeviceRow(row)
  }

  const cleanupPairingCodes = (now: number) => {
    cleanupExpiredCodes.run(now)
  }

  return {
    authenticateDevice(token, now = Date.now()) {
      if (!token) throw new UnauthorizedError('Invalid or missing mobile token')
      const row = selectByToken.get(token) as MobileDeviceRow | undefined
      if (!row) throw new UnauthorizedError('Invalid or missing mobile token')
      const device = mapDeviceRow(row)
      if (device.revoked_at !== null) throw new HttpError(410, 'Mobile device revoked')
      const lastSeenAt = device.last_seen_at ?? device.created_at
      if (now - lastSeenAt > INACTIVE_DEVICE_TTL_MS) {
        throw new UnauthorizedError('Mobile token expired')
      }
      touchByToken.run(now, token)
      return { ...device, last_seen_at: now }
    },
    ensureDefaultDevice() {
      const existing = selectDefault.get() as MobileDeviceRow | undefined
      if (existing) return mapDeviceRow(existing)
      const now = Date.now()
      const record: MobileDeviceRecord = {
        capabilities: LEGACY_M19A_CAPABILITIES,
        created_at: now,
        device_type: 'legacy_m19a',
        id: randomUUID(),
        last_seen_at: null,
        name: 'M19a mobile device',
        revoked_at: null,
        token: generateMobileToken(),
      }
      insertDevice.run(
        record.id,
        record.token,
        record.name,
        JSON.stringify(record.capabilities),
        record.device_type,
        record.revoked_at,
        record.created_at,
        record.last_seen_at
      )
      return record
    },
    generatePairingCode(
      deviceName,
      capabilities,
      expiresInMs = DEFAULT_PAIRING_EXPIRES_IN_MS,
      now = Date.now()
    ) {
      const trimmedName = deviceName.trim()
      if (!trimmedName) throw new BadRequestError('device_name is required')
      const normalized = normalizeCapabilities(capabilities)
      cleanupPairingCodes(now)
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const code = generatePairingCodeValue()
        const expiresAt = now + expiresInMs
        try {
          insertPairingCode.run(code, trimmedName, JSON.stringify(normalized), expiresAt)
          return {
            capabilities: normalized,
            code,
            device_name: trimmedName,
            expires_at: expiresAt,
          }
        } catch {
          // Retry a rare six-digit collision.
        }
      }
      throw new Error('Unable to allocate mobile pairing code')
    },
    listDevices() {
      return (selectDevices.all() as MobileDeviceRow[]).map(mapDeviceRow)
    },
    redeemPairingCode(code, now = Date.now()) {
      const trimmedCode = code.trim()
      const row = selectPairingCode.get(trimmedCode) as
        | {
            capabilities: string
            code: string
            device_name: string
            expires_at: number
            redeemed_at: number | null
          }
        | undefined
      if (!row) throw new BadRequestError('Invalid pairing code')
      if (row.redeemed_at !== null) throw new BadRequestError('Pairing code already redeemed')
      if (row.expires_at <= now) throw new BadRequestError('Pairing code expired')
      const device: MobileDeviceRecord = {
        capabilities: parseCapabilities(row.capabilities),
        created_at: now,
        device_type: 'mobile',
        id: randomUUID(),
        last_seen_at: now,
        name: row.device_name,
        revoked_at: null,
        token: generateMobileToken(),
      }
      db.transaction(() => {
        insertDevice.run(
          device.id,
          device.token,
          device.name,
          JSON.stringify(device.capabilities),
          device.device_type,
          device.revoked_at,
          device.created_at,
          device.last_seen_at
        )
        redeemPairingCode.run(now, device.id, trimmedCode)
      })()
      return { device, token: device.token }
    },
    requireCapability(device, capability) {
      if (!device.capabilities.includes(capability)) {
        throw new ForbiddenError(`Missing mobile capability: ${capability}`)
      }
    },
    revokeDevice(deviceId, now = Date.now()) {
      updateRevokedAt.run(now, deviceId)
      return getDeviceById(deviceId)
    },
    updateDevice(deviceId, patch) {
      if (patch.name !== undefined) {
        const trimmed = patch.name.trim()
        if (!trimmed) throw new BadRequestError('name must not be empty')
        updateName.run(trimmed, deviceId)
      }
      if (patch.capabilities !== undefined) {
        updateCapabilities.run(JSON.stringify(normalizeCapabilities(patch.capabilities)), deviceId)
      }
      return getDeviceById(deviceId)
    },
    validateToken(token) {
      try {
        this.authenticateDevice(token)
        return true
      } catch {
        return false
      }
    },
  }
}
