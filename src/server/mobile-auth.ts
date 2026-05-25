import { randomBytes, randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

import type { Database } from 'better-sqlite3'

import { UnauthorizedError } from './http-errors.js'

export interface MobileDeviceRecord {
  created_at: number
  id: string
  last_seen_at: number | null
  name: string
  token: string
}

export interface MobileAuthStore {
  ensureDefaultDevice: () => MobileDeviceRecord
  validateToken: (token: string | undefined) => boolean
}

const generateMobileToken = () => randomBytes(32).toString('base64url')

export const extractMobileToken = (request: IncomingMessage) => {
  const value = Array.isArray(request.headers.authorization)
    ? request.headers.authorization[0]
    : request.headers.authorization
  if (!value) return undefined
  return /^Bearer\s+(.+)$/i.exec(value)?.[1]
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
    'SELECT id, token, name, created_at, last_seen_at FROM mobile_devices ORDER BY created_at ASC LIMIT 1'
  )
  const insertDevice = db.prepare(
    'INSERT INTO mobile_devices (id, token, name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)'
  )
  const selectByToken = db.prepare(
    'SELECT id, token, name, created_at, last_seen_at FROM mobile_devices WHERE token = ?'
  )
  const touchByToken = db.prepare('UPDATE mobile_devices SET last_seen_at = ? WHERE token = ?')

  return {
    ensureDefaultDevice() {
      const existing = selectDefault.get() as MobileDeviceRecord | undefined
      if (existing) return existing
      const now = Date.now()
      const record: MobileDeviceRecord = {
        created_at: now,
        id: randomUUID(),
        last_seen_at: null,
        name: 'M19a mobile device',
        token: generateMobileToken(),
      }
      insertDevice.run(record.id, record.token, record.name, record.created_at, record.last_seen_at)
      return record
    },
    validateToken(token) {
      if (!token) return false
      const row = selectByToken.get(token) as MobileDeviceRecord | undefined
      if (!row) return false
      touchByToken.run(Date.now(), token)
      return true
    },
  }
}
