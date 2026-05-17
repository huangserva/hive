import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, test } from 'vitest'

import { createDispatchLedgerStore } from '../../src/server/dispatch-ledger-store.js'
import { initializeRuntimeDatabase } from '../../src/server/sqlite-schema.js'

const tempDirs: string[] = []

const createStore = () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hive-dispatch-ledger-'))
  tempDirs.push(dataDir)
  const db = new Database(join(dataDir, 'runtime.sqlite'))
  initializeRuntimeDatabase(db)
  return { db, store: createDispatchLedgerStore(db) }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

describe('dispatch ledger store', () => {
  test('does not treat cancelled or failed dispatches as open work', () => {
    const { db, store } = createStore()
    const cancelled = store.createDispatch({
      text: 'cancelled task',
      toAgentId: 'worker-a',
      workspaceId: 'workspace-a',
    })
    const failed = store.createDispatch({
      text: 'failed task',
      toAgentId: 'worker-a',
      workspaceId: 'workspace-a',
    })
    const queued = store.createDispatch({
      text: 'queued task',
      toAgentId: 'worker-a',
      workspaceId: 'workspace-a',
    })

    db.prepare("UPDATE dispatches SET status = 'cancelled' WHERE id = ?").run(cancelled.id)
    db.prepare("UPDATE dispatches SET status = 'failed' WHERE id = ?").run(failed.id)

    expect(store.findOpenDispatch('workspace-a', 'worker-a', cancelled.id)).toBeUndefined()
    expect(store.findOpenDispatch('workspace-a', 'worker-a', failed.id)).toBeUndefined()
    expect(store.findOpenDispatch('workspace-a', 'worker-a')?.id).toBe(queued.id)
    expect(store.listOpenDispatchKinds()).toEqual([
      { type: 'send', worker_id: 'worker-a', workspace_id: 'workspace-a' },
    ])

    db.close()
  })
})
