import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Database } from 'better-sqlite3'

export interface MediaUploadRecord {
  id: string
  workspace_id: string
  device_id: string | null
  original_name: string
  mime_type: string
  size_bytes: number
  storage_path: string
  created_at: number
}

const UPLOADS_DIR = join(homedir(), '.config', 'hive', 'uploads')

const ensureUploadsDir = () => {
  if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true })
}

export const getUploadsDir = () => UPLOADS_DIR

export const createMediaUploadStore = (db: Database) => {
  const insert = db.prepare(
    `INSERT INTO mobile_media_uploads (id, workspace_id, device_id, original_name, mime_type, size_bytes, storage_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const getById = db.prepare(
    `SELECT id, workspace_id, device_id, original_name, mime_type, size_bytes, storage_path, created_at
     FROM mobile_media_uploads WHERE id = ?`
  )

  return {
    saveUpload(
      workspaceId: string,
      deviceId: string | null,
      originalName: string,
      mimeType: string,
      data: Buffer
    ): MediaUploadRecord {
      ensureUploadsDir()
      const id = randomUUID()
      const ext = originalName.includes('.')
        ? originalName.slice(originalName.lastIndexOf('.'))
        : ''
      const storageName = `${id}${ext}`
      const storagePath = join(UPLOADS_DIR, storageName)
      writeFileSync(storagePath, data)
      const record: MediaUploadRecord = {
        id,
        workspace_id: workspaceId,
        device_id: deviceId,
        original_name: originalName,
        mime_type: mimeType,
        size_bytes: data.length,
        storage_path: storagePath,
        created_at: Date.now(),
      }
      insert.run(
        id,
        workspaceId,
        deviceId,
        originalName,
        mimeType,
        data.length,
        storagePath,
        record.created_at
      )
      return record
    },
    getUpload(id: string): MediaUploadRecord | null {
      return (getById.get(id) as MediaUploadRecord) ?? null
    },
    readUploadData(record: MediaUploadRecord): Buffer | null {
      if (!existsSync(record.storage_path)) return null
      return readFileSync(record.storage_path)
    },
  }
}
