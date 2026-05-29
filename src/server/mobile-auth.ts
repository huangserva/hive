import { randomBytes, randomUUID } from 'node:crypto'
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

export interface MobileDeviceRecord {
  capabilities: MobileCapability[]
  created_at: number
  device_type: string | null
  id: string
  last_seen_at: number | null
  name: string
  push_token: string | null
  revoked_at: number | null
  source: 'manual'
  token: string
}

interface MobileDeviceRow {
  capabilities: string | null
  created_at: number
  device_type: string | null
  id: string
  last_seen_at: number | null
  name: string
  push_token: string | null
  revoked_at: number | null
  source: string | null
  token: string
}

export interface MobileAuthStore {
  authenticateDevice: (token: string | undefined, now?: number) => MobileDeviceRecord
  createDeviceToken: (
    name: string,
    capabilities: MobileCapability[],
    now?: number
  ) => { device: MobileDeviceRecord; token: string }
  deleteDevice: (deviceId: string) => void
  listDevices: () => MobileDeviceRecord[]
  requireCapability: (device: MobileDeviceRecord, capability: MobileCapability) => void
  revokeDevice: (deviceId: string, now?: number) => MobileDeviceRecord
  clearPushToken: (pushToken: string) => void
  updateDevice: (
    deviceId: string,
    patch: { capabilities?: MobileCapability[]; name?: string }
  ) => MobileDeviceRecord
  updatePushToken: (deviceId: string, pushToken: string) => MobileDeviceRecord
  validateToken: (token: string | undefined) => boolean
}

const generateMobileToken = () => randomBytes(32).toString('base64url')

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
  push_token: row.push_token,
  revoked_at: row.revoked_at,
  source: 'manual',
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
  const insertDevice = db.prepare(
    `INSERT INTO mobile_devices (
      id,
      token,
      name,
      capabilities,
      device_type,
      push_token,
      revoked_at,
      source,
      created_at,
      last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const selectByToken = db.prepare(
    'SELECT id, token, name, capabilities, device_type, revoked_at, push_token, source, created_at, last_seen_at FROM mobile_devices WHERE token = ?'
  )
  const selectById = db.prepare(
    'SELECT id, token, name, capabilities, device_type, revoked_at, push_token, source, created_at, last_seen_at FROM mobile_devices WHERE id = ?'
  )
  const touchByToken = db.prepare('UPDATE mobile_devices SET last_seen_at = ? WHERE token = ?')
  const selectDevices = db.prepare(
    'SELECT id, token, name, capabilities, device_type, revoked_at, push_token, source, created_at, last_seen_at FROM mobile_devices ORDER BY created_at ASC'
  )
  const updateRevokedAt = db.prepare('UPDATE mobile_devices SET revoked_at = ? WHERE id = ?')
  const deleteDeviceById = db.prepare('DELETE FROM mobile_devices WHERE id = ?')
  const updateName = db.prepare('UPDATE mobile_devices SET name = ? WHERE id = ?')
  const updateCapabilities = db.prepare('UPDATE mobile_devices SET capabilities = ? WHERE id = ?')
  const updatePushTokenStmt = db.prepare('UPDATE mobile_devices SET push_token = ? WHERE id = ?')
  const clearPushTokenStmt = db.prepare(
    'UPDATE mobile_devices SET push_token = NULL WHERE push_token = ?'
  )

  const getDeviceById = (deviceId: string) => {
    const row = selectById.get(deviceId) as MobileDeviceRow | undefined
    if (!row) throw new BadRequestError(`Mobile device not found: ${deviceId}`)
    return mapDeviceRow(row)
  }

  return {
    authenticateDevice(token, now = Date.now()) {
      if (!token) throw new UnauthorizedError('Invalid or missing mobile token')
      const row = selectByToken.get(token) as MobileDeviceRow | undefined
      if (!row) throw new UnauthorizedError('Invalid or missing mobile token')
      const device = mapDeviceRow(row)
      if (device.revoked_at !== null) throw new HttpError(410, 'Mobile device revoked')
      touchByToken.run(now, token)
      return { ...device, last_seen_at: now }
    },
    createDeviceToken(name, capabilities, now = Date.now()) {
      const trimmedName = name.trim()
      if (!trimmedName) throw new BadRequestError('name is required')
      const normalized = normalizeCapabilities(capabilities)
      const device: MobileDeviceRecord = {
        capabilities: normalized,
        created_at: now,
        device_type: 'mobile',
        id: randomUUID(),
        last_seen_at: null,
        name: trimmedName,
        push_token: null,
        revoked_at: null,
        source: 'manual',
        token: generateMobileToken(),
      }
      insertDevice.run(
        device.id,
        device.token,
        device.name,
        JSON.stringify(device.capabilities),
        device.device_type,
        device.push_token,
        device.revoked_at,
        device.source,
        device.created_at,
        device.last_seen_at
      )
      return { device, token: device.token }
    },
    deleteDevice(deviceId) {
      const result = deleteDeviceById.run(deviceId)
      if (result.changes === 0) throw new BadRequestError(`Mobile device not found: ${deviceId}`)
    },
    listDevices() {
      return (selectDevices.all() as MobileDeviceRow[]).map(mapDeviceRow)
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
    clearPushToken(pushToken) {
      clearPushTokenStmt.run(pushToken)
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
    updatePushToken(deviceId, pushToken) {
      const trimmed = pushToken.trim()
      if (!trimmed) throw new BadRequestError('push_token is required')
      updatePushTokenStmt.run(trimmed, deviceId)
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
