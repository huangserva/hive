import Database from 'better-sqlite3'
import { describe, expect, test } from 'vitest'

import { createAgentRunTimelineStore } from '../../src/server/agent-run-timeline-store.js'
import { initializeRuntimeDatabase } from '../../src/server/sqlite-schema.js'
import { applySchemaVersion32 } from '../../src/server/sqlite-schema-v32.js'

describe('AgentRunTimelineStore', () => {
  const createStore = () => {
    const db = new Database(':memory:')
    applySchemaVersion32(db)
    return { db, store: createAgentRunTimelineStore(db) }
  }

  test('append assigns run-scoped monotonic seq and preserves epoch', () => {
    const { db, store } = createStore()
    try {
      const first = store.appendEvent({
        agentId: 'agent-1',
        eventType: 'pty_chunk',
        payloadJson: JSON.stringify({ text: 'one' }),
        runId: 'run-1',
        workspaceId: 'ws-1',
      })
      const second = store.appendEvent({
        agentId: 'agent-1',
        epoch: 2,
        eventType: 'tool_start',
        payloadJson: JSON.stringify({ tool: 'shell' }),
        runId: 'run-1',
        workspaceId: 'ws-1',
      })
      const otherRun = store.appendEvent({
        agentId: 'agent-2',
        eventType: 'pty_chunk',
        payloadJson: JSON.stringify({ text: 'other' }),
        runId: 'run-2',
        workspaceId: 'ws-1',
      })

      expect(first).toMatchObject({ epoch: 1, seq: 1 })
      expect(second).toMatchObject({ epoch: 2, seq: 2 })
      expect(otherRun).toMatchObject({ epoch: 1, seq: 1 })
      expect(store.listEvents('run-1').map((event) => event.seq)).toEqual([1, 2])
    } finally {
      db.close()
    }
  })

  test('fetches tail, before, and after windows with stable cursors', () => {
    const { db, store } = createStore()
    try {
      for (const text of ['one', 'two', 'three', 'four']) {
        store.appendEvent({
          eventType: 'pty_chunk',
          payloadJson: JSON.stringify({ text }),
          runId: 'run-1',
          workspaceId: 'ws-1',
        })
      }

      const tail = store.fetchWindow('run-1', { direction: 'tail', limit: 2 })
      expect(tail.events.map((event) => event.seq)).toEqual([3, 4])
      expect(tail.startCursor).toEqual({ epoch: 1, seq: 3 })
      expect(tail.endCursor).toEqual({ epoch: 1, seq: 4 })
      expect(tail.hasMoreBefore).toBe(true)
      expect(tail.hasMoreAfter).toBe(false)

      const before = store.fetchWindow('run-1', {
        cursor: { epoch: 1, seq: 3 },
        direction: 'before',
        limit: 2,
      })
      expect(before.events.map((event) => event.seq)).toEqual([1, 2])
      expect(before.hasMoreBefore).toBe(false)
      expect(before.hasMoreAfter).toBe(true)

      const after = store.fetchWindow('run-1', {
        cursor: { epoch: 1, seq: 2 },
        direction: 'after',
        limit: 10,
      })
      expect(after.events.map((event) => event.seq)).toEqual([3, 4])
      expect(after.gap).toBe(false)
      expect(after.staleCursor).toBe(false)
    } finally {
      db.close()
    }
  })

  test('marks stale cursor when epoch does not match current run epoch', () => {
    const { db, store } = createStore()
    try {
      store.appendEvent({
        epoch: 2,
        eventType: 'reset',
        payloadJson: '{}',
        runId: 'run-1',
        workspaceId: 'ws-1',
      })
      const result = store.fetchWindow('run-1', {
        cursor: { epoch: 1, seq: 1 },
        direction: 'after',
        limit: 10,
      })
      expect(result.events).toEqual([])
      expect(result.staleCursor).toBe(true)
      expect(result.reset).toBe(true)
    } finally {
      db.close()
    }
  })
})

describe('schema v32 migration', () => {
  test('creates durable agent_run_timeline_events table and schema version', () => {
    const db = new Database(':memory:')
    try {
      initializeRuntimeDatabase(db)
      const table = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_run_timeline_events'"
        )
        .get()
      const columns = (
        db.prepare('PRAGMA table_info(agent_run_timeline_events)').all() as Array<{ name: string }>
      ).map((column) => column.name)
      const version = db.prepare('SELECT version FROM schema_version WHERE version = 32').get()
      expect(table).toEqual({ name: 'agent_run_timeline_events' })
      expect(columns).toEqual([
        'id',
        'run_id',
        'workspace_id',
        'agent_id',
        'seq',
        'epoch',
        'event_type',
        'payload_json',
        'created_at',
      ])
      expect(version).toMatchObject({ version: 32 })
    } finally {
      db.close()
    }
  })

  test('rolls back v32 schema_version insert when migration cannot complete', () => {
    const db = new Database(':memory:')
    try {
      db.exec(`
        CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
        INSERT INTO schema_version (version, applied_at) VALUES
          (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6), (7, 7), (8, 8),
          (9, 9), (10, 10), (11, 11), (12, 12), (13, 13), (14, 14), (15, 15),
          (16, 16), (17, 17), (18, 18), (19, 19), (20, 20), (21, 21), (22, 22),
          (23, 23), (24, 24), (25, 25), (26, 26), (27, 27), (28, 28), (29, 29),
          (30, 30), (31, 31);
        CREATE TABLE agent_run_timeline_events (id TEXT PRIMARY KEY);
      `)
      expect(() => initializeRuntimeDatabase(db)).toThrow()
      expect(
        db.prepare('SELECT version FROM schema_version WHERE version = 32').get()
      ).toBeUndefined()
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_agent_run_timeline_run_seq'"
          )
          .get()
      ).toBeUndefined()
    } finally {
      db.close()
    }
  })
})
