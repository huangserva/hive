import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import {
  createRuntimeStoreLifecycle,
  createRuntimeStoreServices,
} from '../../src/server/runtime-store-helpers.js'

const tempDirs: string[] = []
const lifecycles: Array<ReturnType<typeof createRuntimeStoreLifecycle>> = []

afterEach(async () => {
  await Promise.all(lifecycles.splice(0).map((lifecycle) => lifecycle.close()))
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

describe('team report DB atomicity', () => {
  test('rolls back dispatch ledger when mobile chat DB write fails', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-report-atomicity-'))
    const workspacePath = join(dataDir, 'workspace')
    mkdirSync(workspacePath, { recursive: true })
    tempDirs.push(dataDir)

    const services = createRuntimeStoreServices({ dataDir })
    const lifecycle = createRuntimeStoreLifecycle({ services })
    lifecycles.push(lifecycle)

    const workspace = services.workspaceStore.createWorkspace(workspacePath, 'Alpha')
    const worker = services.workspaceStore.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
    const dispatch = await services.teamOps.dispatchTask(
      workspace.id,
      worker.id,
      'Implement atomic report'
    )

    services.db
      .prepare(
        `CREATE TRIGGER fail_mobile_chat_insert
         BEFORE INSERT ON mobile_chat_messages
         BEGIN
           SELECT RAISE(ABORT, 'mobile chat insert failed');
         END`
      )
      .run()

    expect(() =>
      services.teamOps.reportTask(workspace.id, worker.id, {
        status: 'success',
        text: 'Done',
      })
    ).toThrow(/mobile chat insert failed/)

    expect(services.dispatchLedgerStore.findOpenDispatchById(workspace.id, dispatch.id)).toEqual(
      expect.objectContaining({ id: dispatch.id, status: 'queued' })
    )
    expect(services.dispatchLedgerStore.listWorkspaceDispatches(workspace.id)).toContainEqual(
      expect.objectContaining({ id: dispatch.id, reportText: null, status: 'queued' })
    )
    expect(services.messageLogStore.listMessagesForRecovery(workspace.id, 0)).not.toContainEqual(
      expect.objectContaining({ kind: 'report' })
    )
  })
})
