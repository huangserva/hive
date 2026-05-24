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

  test('markCancelled on already reported dispatch returns undefined', () => {
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
