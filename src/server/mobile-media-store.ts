import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { IncomingMessage } from 'node:http'

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
      const ext = originalName.includes('.') ? originalName.slice(originalName.lastIndexOf('.')) : ''
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
      insert.run(id, workspaceId, deviceId, originalName, mimeType, data.length, storagePath, record.created_at)
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

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024

export const parseMultipartUpload = async (
  request: IncomingMessage
): Promise<{ fileName: string; mimeType: string; data: Buffer } | null> => {
  const contentType = request.headers['content-type'] ?? ''
  const boundaryMatch = contentType.match(/boundary=([^\s;]+)/)
  if (!boundaryMatch) return null
  const boundary = boundaryMatch[1]

  const chunks: Buffer[] = []
  let totalSize = 0
  for await (const chunk of request) {
    totalSize += (chunk as Buffer).length
    if (totalSize > MAX_UPLOAD_SIZE) return null
    chunks.push(chunk as Buffer)
  }
  const body = Buffer.concat(chunks)
  const boundaryBuf = Buffer.from(`--${boundary}`)
  const parts = splitBuffer(body, boundaryBuf).slice(1)

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n')
    if (headerEnd === -1) continue
    const headers = part.slice(0, headerEnd).toString('utf8')
    if (!headers.includes('filename=')) continue
    const nameMatch = headers.match(/filename="([^"]*)"/)
    const typeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i)
    const fileName = nameMatch?.[1] ?? 'upload'
    const mimeType = typeMatch?.[1]?.trim() ?? 'application/octet-stream'
    const data = part.slice(headerEnd + 4, part.length - 2)
    return { fileName, mimeType, data }
  }
  return null
}

const splitBuffer = (buf: Buffer, delimiter: Buffer): Buffer[] => {
  const parts: Buffer[] = []
  let start = 0
  while (true) {
    const idx = buf.indexOf(delimiter, start)
    if (idx === -1) {
      parts.push(buf.slice(start))
      break
    }
    parts.push(buf.slice(start, idx))
    start = idx + delimiter.length
  }
  return parts
}
