import Database from 'better-sqlite3'
import { afterEach, describe, expect, test } from 'vitest'

import { openRuntimeDatabase } from '../../src/server/runtime-database.js'
import { applySchemaVersion21 } from '../../src/server/sqlite-schema-v21.js'

describe('applySchemaVersion21', () => {
  let db: Database

  afterEach(() => {
    db.close()
  })

  test('creates feishu_bindings table with correct columns and constraints', () => {
    db = openRuntimeDatabase()
    const columns = new Set(
      (db.prepare('PRAGMA table_info(feishu_bindings)').all() as Array<{ name: string }>).map(
        (col) => col.name
      )
    )
    expect(columns).toEqual(
      new Set(['id', 'workspace_id', 'chat_id', 'chat_name', 'enabled', 'created_at'])
    )
    const tableSql = (
      db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='feishu_bindings'")
        .get() as { sql: string } | undefined
    )?.sql ?? ''
    expect(tableSql).toContain('chat_id TEXT NOT NULL UNIQUE')
  })

  test('creates workspace index on feishu_bindings', () => {
    db = openRuntimeDatabase()
    const indexes = new Set(
      (db.prepare('PRAGMA index_list(feishu_bindings)').all() as Array<{ name: string }>).map(
        (idx) => idx.name
      )
    )
    expect(indexes.has('idx_feishu_bindings_workspace')).toBe(true)
  })

  test('is idempotent — applying twice does not throw', () => {
    db = new Database(':memory:')
    applySchemaVersion21(db)
    expect(() => applySchemaVersion21(db)).not.toThrow()
  })

  test('is idempotent — existing data survives re-apply', () => {
    db = new Database(':memory:')
    applySchemaVersion21(db)
    db.prepare(
      'INSERT INTO feishu_bindings (id, workspace_id, chat_id, chat_name, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('test-id', 'ws-1', 'oc_abc', 'My Chat', 1, 1000)
    applySchemaVersion21(db)
    const row = db
      .prepare('SELECT id, chat_id, chat_name FROM feishu_bindings WHERE id = ?')
      .get('test-id') as { id: string; chat_id: string; chat_name: string } | undefined
    expect(row).toEqual({ id: 'test-id', chat_id: 'oc_abc', chat_name: 'My Chat' })
  })

  test('v21 migration applies on top of v20 database via initializeRuntimeDatabase', () => {
    db = openRuntimeDatabase()
    const columns = new Set(
      (db.prepare('PRAGMA table_info(feishu_bindings)').all() as Array<{ name: string }>).map(
        (col) => col.name
      )
    )
    expect(columns.size).toBe(6)
    expect(columns.has('id')).toBe(true)
    expect(columns.has('chat_id')).toBe(true)
    const version = db
      .prepare('SELECT version FROM schema_version WHERE version = ?')
      .get(21) as { version: number } | undefined
    expect(version).toEqual({ version: 21 })
  })
})
