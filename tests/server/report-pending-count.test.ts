import { describe, expect, test } from 'vitest'

import { createRuntimeStore } from '../../src/server/runtime-store.js'

describe('report pending count', () => {
  test('rejects a second open dispatch for the same worker', async () => {
    const store = createRuntimeStore()
    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')
    const worker = store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
    // Simulate PTY started before dispatching.
    store.getWorker(workspace.id, worker.id).status = 'idle'

    const first = await store.dispatchTask(workspace.id, worker.id, 'Task 1')

    await expect(store.dispatchTask(workspace.id, worker.id, 'Task 2')).rejects.toThrow(
      new RegExp(`already has open dispatch ${first.id}`)
    )
    expect(store.listDispatches(workspace.id)).toEqual([
      expect.objectContaining({ id: first.id, status: 'queued', text: 'Task 1' }),
    ])
  })

  test('allows the next dispatch after the previous open dispatch is reported', async () => {
    const store = createRuntimeStore()
    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')
    const worker = store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
    store.getWorker(workspace.id, worker.id).status = 'idle'

    const first = await store.dispatchTask(workspace.id, worker.id, 'Task 1')
    store.reportTask(workspace.id, worker.id, {
      dispatchId: first.id,
      status: 'success',
      text: 'Done one',
    })
    const second = await store.dispatchTask(workspace.id, worker.id, 'Task 2')

    expect(second).toMatchObject({ status: 'queued', text: 'Task 2' })
    expect(store.listDispatches(workspace.id)).toEqual([
      expect.objectContaining({ id: first.id, status: 'completed', text: 'Task 1' }),
      expect.objectContaining({ id: second.id, status: 'queued', text: 'Task 2' }),
    ])
  })
})
