import { randomUUID } from 'node:crypto'

import type { Database } from 'better-sqlite3'

export type MobileChatDirection = 'inbound' | 'outbound'

export type MobileChatMessageType =
  | 'approval_request'
  | 'orch_reply'
  | 'system_event'
  | 'user_text'
  | 'worker_report'

export interface MobileChatMessage {
  content_json: string
  created_at: number
  direction: MobileChatDirection
  id: string
  message_type: MobileChatMessageType
  workspace_id: string
}

interface MobileChatMessageRow {
  content_json: string
  created_at: number
  direction: MobileChatDirection
  id: string
  message_type: MobileChatMessageType
  workspace_id: string
}

const mapRow = (row: MobileChatMessageRow): MobileChatMessage => ({
  content_json: row.content_json,
  created_at: row.created_at,
  direction: row.direction,
  id: row.id,
  message_type: row.message_type,
  workspace_id: row.workspace_id,
})

const normalizeLimit = (limit: number | undefined) => {
  if (limit === undefined) return 50
  if (!Number.isFinite(limit)) return 50
  return Math.min(Math.max(Math.trunc(limit), 1), 100)
}

export const createMobileChatStore = (db: Database) => {
  const maxCreatedAtRow = db
    .prepare('SELECT MAX(created_at) AS max_created_at FROM mobile_chat_messages')
    .get() as { max_created_at: number | null }
  let lastCreatedAt = maxCreatedAtRow.max_created_at ?? 0
  const insert = db.prepare(
    `INSERT INTO mobile_chat_messages (
      id,
      workspace_id,
      direction,
      message_type,
      content_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`
  )
  const listAll = db.prepare(
    `SELECT id, workspace_id, direction, message_type, content_json, created_at
     FROM mobile_chat_messages
     WHERE workspace_id = ?
     ORDER BY created_at ASC, id ASC
     LIMIT ?`
  )
  const listSince = db.prepare(
    `SELECT id, workspace_id, direction, message_type, content_json, created_at
     FROM mobile_chat_messages
     WHERE workspace_id = ?
       AND created_at > ?
     ORDER BY created_at ASC, id ASC
     LIMIT ?`
  )

  const nextCreatedAt = () => {
    const now = Date.now()
    const createdAt = now <= lastCreatedAt ? lastCreatedAt + 1 : now
    lastCreatedAt = createdAt
    return createdAt
  }

  return {
    insertChatMessage(
      workspaceId: string,
      direction: MobileChatDirection,
      messageType: MobileChatMessageType,
      contentJson: string
    ): MobileChatMessage {
      const record: MobileChatMessage = {
        content_json: contentJson,
        created_at: nextCreatedAt(),
        direction,
        id: randomUUID(),
        message_type: messageType,
        workspace_id: workspaceId,
      }
      insert.run(
        record.id,
        record.workspace_id,
        record.direction,
        record.message_type,
        record.content_json,
        record.created_at
      )
      return record
    },
    listChatMessages(workspaceId: string, since?: number, limit?: number): MobileChatMessage[] {
      const normalizedLimit = normalizeLimit(limit)
      const rows =
        since === undefined
          ? (listAll.all(workspaceId, normalizedLimit) as MobileChatMessageRow[])
          : (listSince.all(workspaceId, since, normalizedLimit) as MobileChatMessageRow[])
      return rows.map(mapRow)
    },
  }
}
