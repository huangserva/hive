import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'

import { BadRequestError, ConflictError } from './http-errors.js'

export interface FeishuBinding {
  id: string
  workspaceId: string
  chatId: string
  chatName: string | null
  enabled: boolean
  createdAt: number
}

interface BindingRow {
  id: string
  workspace_id: string
  chat_id: string
  chat_name: string | null
  enabled: number
  created_at: number
}

const rowToBinding = (row: BindingRow): FeishuBinding => ({
  id: row.id,
  workspaceId: row.workspace_id,
  chatId: row.chat_id,
  chatName: row.chat_name,
  enabled: row.enabled !== 0,
  createdAt: row.created_at,
})

export interface FeishuBindingsStore {
  bind: (input: { workspaceId: string; chatId: string; chatName?: string | null }) => FeishuBinding
  unbind: (chatId: string) => boolean
  unbindByWorkspace: (workspaceId: string) => void
  findByChatId: (chatId: string) => FeishuBinding | null
  listByWorkspace: (workspaceId: string) => FeishuBinding[]
  listAll: () => FeishuBinding[]
}

const SELECT_COLUMNS =
  'id, workspace_id, chat_id, chat_name, enabled, created_at FROM feishu_bindings'

const MAX_CHAT_ID_LENGTH = 256
const MAX_CHAT_NAME_LENGTH = 200

const normalizeChatId = (chatId: string) => {
  const trimmed = chatId.trim()
  if (!trimmed) throw new BadRequestError('chat_id must not be empty')
  if (trimmed.length > MAX_CHAT_ID_LENGTH) {
    throw new BadRequestError(`chat_id must be at most ${MAX_CHAT_ID_LENGTH} characters`)
  }
  return trimmed
}

const normalizeChatName = (chatName: string | null | undefined) => {
  const trimmed = chatName?.trim()
  if (!trimmed) return null
  if (trimmed.length > MAX_CHAT_NAME_LENGTH) {
    throw new BadRequestError(`chat_name must be at most ${MAX_CHAT_NAME_LENGTH} characters`)
  }
  return trimmed
}

export const createFeishuBindingsStore = (db: Database): FeishuBindingsStore => {
  return {
    bind({ workspaceId, chatId, chatName }) {
      const trimmedChatId = normalizeChatId(chatId)
      const normalizedChatName = normalizeChatName(chatName)
      const existing = db
        .prepare(`SELECT ${SELECT_COLUMNS} WHERE chat_id = ?`)
        .get(trimmedChatId) as BindingRow | undefined
      if (existing) {
        if (existing.workspace_id === workspaceId) {
          db.prepare('UPDATE feishu_bindings SET chat_name = ?, enabled = 1 WHERE chat_id = ?').run(
            normalizedChatName,
            trimmedChatId
          )
          return rowToBinding({
            ...existing,
            chat_name: normalizedChatName,
            enabled: 1,
          })
        }
        throw new ConflictError(
          `chat_id already bound to workspace ${existing.workspace_id}: ${trimmedChatId}`
        )
      }
      const binding: FeishuBinding = {
        id: randomUUID(),
        workspaceId,
        chatId: trimmedChatId,
        chatName: normalizedChatName,
        enabled: true,
        createdAt: Date.now(),
      }
      try {
        db.prepare(
          'INSERT INTO feishu_bindings (id, workspace_id, chat_id, chat_name, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
          binding.id,
          binding.workspaceId,
          binding.chatId,
          binding.chatName,
          binding.enabled ? 1 : 0,
          binding.createdAt
        )
      } catch (error) {
        if ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new ConflictError(`chat_id already bound: ${trimmedChatId}`)
        }
        throw error
      }
      return binding
    },
    unbind(chatId) {
      const result = db.prepare('DELETE FROM feishu_bindings WHERE chat_id = ?').run(chatId.trim())
      return result.changes > 0
    },
    unbindByWorkspace(workspaceId) {
      db.prepare('DELETE FROM feishu_bindings WHERE workspace_id = ?').run(workspaceId)
    },
    findByChatId(chatId) {
      const row = db.prepare(`SELECT ${SELECT_COLUMNS} WHERE chat_id = ?`).get(chatId.trim()) as
        | BindingRow
        | undefined
      return row ? rowToBinding(row) : null
    },
    listByWorkspace(workspaceId) {
      const rows = db
        .prepare(`SELECT ${SELECT_COLUMNS} WHERE workspace_id = ? ORDER BY created_at ASC`)
        .all(workspaceId) as BindingRow[]
      return rows.map(rowToBinding)
    },
    listAll() {
      const rows = db
        .prepare(`SELECT ${SELECT_COLUMNS} ORDER BY created_at ASC`)
        .all() as BindingRow[]
      return rows.map(rowToBinding)
    },
  }
}
