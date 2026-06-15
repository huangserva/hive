import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { createDispatchLedgerStore } from '../../src/server/dispatch-ledger-store.js'
import { openRuntimeDatabase } from '../../src/server/runtime-database.js'

describe('dispatch ledger — cancel', () => {
  let db: ReturnType<typeof openRuntimeDatabase>
  let store: ReturnType<typeof createDispatchLedgerStore>

  beforeEach(() => {
    db = openRuntimeDatabase()
    store = createDispatchLedgerStore(db)
  })

  afterEach(() => {
    db.close()
  })

  test('createDispatch returns the SQLite-assigned sequence', () => {
    const first = store.createDispatch({
      text: 'first task',
      toAgentId: 'worker-1',
      workspaceId: 'ws-1',
    })
    const second = store.createDispatch({
      text: 'second task',
      toAgentId: 'worker-1',
      workspaceId: 'ws-1',
    })

    const rows = db
      .prepare('SELECT id, sequence FROM dispatches ORDER BY sequence ASC')
      .all() as Array<{ id: string; sequence: number }>

    expect(first.sequence).toBe(rows[0]?.sequence)
    expect(second.sequence).toBe(rows[1]?.sequence)
    expect(first.sequence).not.toBeNull()
    expect(second.sequence).not.toBeNull()
    expect(second.sequence ?? 0).toBeGreaterThan(first.sequence ?? 0)
  })

  test('markCancelled transitions status from queued to cancelled', () => {
    const dispatch = store.createDispatch({
      text: 'do something',
      toAgentId: 'worker-1',
      workspaceId: 'ws-1',
    })
    expect(dispatch.status).toBe('queued')

    const cancelled = store.markCancelled({
      dispatchId: dispatch.id,
      reason: 'wrong direction',
      workspaceId: 'ws-1',
    })
    expect(cancelled).not.toBeUndefined()
    expect(cancelled?.status).toBe('cancelled')
    expect(cancelled?.reportText).toBe('wrong direction')
  })

  test('markCancelled returns undefined for nonexistent dispatchId', () => {
    const result = store.markCancelled({
      dispatchId: 'nonexistent-id',
      reason: 'test',
      workspaceId: 'ws-1',
    })
    expect(result).toBeUndefined()
  })

  test('findOpenDispatch does not return cancelled dispatch', () => {
    const dispatch = store.createDispatch({
      text: 'task',
      toAgentId: 'worker-1',
      workspaceId: 'ws-1',
    })
    store.markSubmitted(dispatch.id)
    store.markCancelled({ dispatchId: dispatch.id, reason: 'done', workspaceId: 'ws-1' })

    const found = store.findOpenDispatch('ws-1', 'worker-1')
    expect(found).toBeUndefined()
  })

  test('markSubmitted moves an injected dispatch into running, not completed', () => {
    const dispatch = store.createDispatch({
      text: 'task',
      toAgentId: 'worker-1',
      workspaceId: 'ws-1',
    })

    store.markSubmitted(dispatch.id)

    const found = store.findOpenDispatch('ws-1', 'worker-1', dispatch.id)
    expect(found?.status).toBe('running')
    expect(found?.reportedAt).toBeNull()
  })

  test('markReportOverdue flags active unreported dispatch without completing it', () => {
    const dispatch = store.createDispatch({
      text: 'task',
      toAgentId: 'worker-1',
      workspaceId: 'ws-1',
    })
    store.markSubmitted(dispatch.id)

    const overdue = store.markReportOverdue(dispatch.id)

    expect(overdue?.status).toBe('report_overdue')
    expect(overdue?.reportedAt).toBeNull()
    expect(store.findOpenDispatch('ws-1', 'worker-1', dispatch.id)?.status).toBe('report_overdue')
  })

  test('explicit report is the only path that completes an active dispatch', () => {
    const dispatch = store.createDispatch({
      text: 'task',
      toAgentId: 'worker-1',
      workspaceId: 'ws-1',
    })
    store.markSubmitted(dispatch.id)
    store.markReportOverdue(dispatch.id)

    const completed = store.markReportedByWorker({
      artifacts: [],
      dispatchId: dispatch.id,
      reportText: 'done',
      toAgentId: 'worker-1',
      workspaceId: 'ws-1',
    })

    expect(completed?.status).toBe('completed')
    expect(completed?.reportText).toBe('done')
    expect(store.findOpenDispatch('ws-1', 'worker-1', dispatch.id)).toBeUndefined()
  })

  test('markOrphaned closes active dispatch without treating it as completed', () => {
    const dispatch = store.createDispatch({
      text: 'task',
      toAgentId: 'worker-1',
      workspaceId: 'ws-1',
    })
    store.markSubmitted(dispatch.id)

    const orphaned = store.markOrphaned({
      dispatchId: dispatch.id,
      reason: 'worker stopped',
      workspaceId: 'ws-1',
    })

    expect(orphaned?.status).toBe('orphaned')
    expect(orphaned?.reportText).toBe('worker stopped')
    expect(store.findOpenDispatch('ws-1', 'worker-1', dispatch.id)).toBeUndefined()
  })

  test('findOpenDispatchById returns undefined for cancelled dispatch', () => {
    const dispatch = store.createDispatch({
      text: 'task',
      toAgentId: 'worker-1',
      workspaceId: 'ws-1',
    })
    store.markCancelled({ dispatchId: dispatch.id, reason: 'abort', workspaceId: 'ws-1' })

    const found = store.findOpenDispatchById('ws-1', dispatch.id)
    expect(found).toBeUndefined()
  })

  test('markCancelled on already completed dispatch returns undefined', () => {
    const dispatch = store.createDispatch({
      text: 'task',
      toAgentId: 'worker-1',
      workspaceId: 'ws-1',
    })
    store.markSubmitted(dispatch.id)
    store.markReportedByWorker({
      artifacts: [],
      reportText: 'done',
      toAgentId: 'worker-1',
      workspaceId: 'ws-1',
    })

    const result = store.markCancelled({
      dispatchId: dispatch.id,
      reason: 'too late',
      workspaceId: 'ws-1',
    })
    expect(result).toBeUndefined()
  })

  test('markCancelled on already cancelled dispatch returns undefined', () => {
    const dispatch = store.createDispatch({
      text: 'task',
      toAgentId: 'worker-1',
      workspaceId: 'ws-1',
    })
    store.markCancelled({ dispatchId: dispatch.id, reason: 'first cancel', workspaceId: 'ws-1' })

    const second = store.markCancelled({
      dispatchId: dispatch.id,
      reason: 'second cancel',
      workspaceId: 'ws-1',
    })
    expect(second).toBeUndefined()
  })
})
