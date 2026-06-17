import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { createAgentManager } from '../../src/server/agent-manager.js'
import { createRuntimeStore } from '../../src/server/runtime-store.js'
import { createRuntimeStoreServices } from '../../src/server/runtime-store-helpers.js'
import { HIVE_DIR_NAME } from '../../src/server/tasks-file.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const setupWorkspace = () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hive-sync-data-'))
  tempDirs.push(dataDir)
  const workspacePath = mkdtempSync(join(tmpdir(), 'hive-sync-ws-'))
  tempDirs.push(workspacePath)
  mkdirSync(join(workspacePath, HIVE_DIR_NAME), { recursive: true })
  writeFileSync(
    join(workspacePath, HIVE_DIR_NAME, 'tasks.md'),
    '## In progress\n\n## Open\n\n## Done\n',
    'utf8'
  )

  const agentManager = createAgentManager()
  const store = createRuntimeStore({ agentManager, dataDir })
  const workspace = store.createWorkspace(workspacePath, 'Sync Test')
  const worker = store.addWorker(workspace.id, {
    name: '关羽',
    role: 'coder',
  })

  return { store, worker, workspace, workspacePath }
}

const readTasks = (workspacePath: string) => {
  const path = join(workspacePath, HIVE_DIR_NAME, 'tasks.md')
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

const setupServicesWorkspace = () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hive-sync-services-data-'))
  tempDirs.push(dataDir)
  const workspacePath = mkdtempSync(join(tmpdir(), 'hive-sync-services-ws-'))
  tempDirs.push(workspacePath)
  mkdirSync(join(workspacePath, HIVE_DIR_NAME), { recursive: true })
  writeFileSync(
    join(workspacePath, HIVE_DIR_NAME, 'tasks.md'),
    '## In progress\n\n## Open\n\n## Done\n',
    'utf8'
  )

  const services = createRuntimeStoreServices({ dataDir })
  const workspace = services.workspaceStore.createWorkspace(workspacePath, 'Sync Services Test')
  const worker = services.workspaceStore.addWorker(workspace.id, {
    name: '关羽',
    role: 'coder',
  })

  return { services, worker, workspace, workspacePath }
}

describe('team-operations tasks lifecycle sync', () => {
  test('dispatch appends new dispatch line to tasks.md', async () => {
    const { store, worker, workspace, workspacePath } = setupWorkspace()
    const dispatch = await store.dispatchTask(workspace.id, worker.id, 'Implement auth')
    const content = readTasks(workspacePath)
    expect(content).toContain(`dispatch \`${dispatch.id.slice(0, 8)}\``)
    expect(content).toContain('Implement auth')
    expect(content).toContain('**关羽**')
  })

  test('dispatch then report marks line as [x]', async () => {
    const { store, worker, workspace, workspacePath } = setupWorkspace()
    const dispatch = await store.dispatchTask(workspace.id, worker.id, 'Write tests')
    store.reportTask(workspace.id, worker.id, {
      dispatchId: dispatch.id,
      status: 'success',
      text: 'Done',
    })
    const content = readTasks(workspacePath)
    const shortId = dispatch.id.slice(0, 8)
    expect(content).toContain(`- [x] **关羽** dispatch \`${shortId}\``)
  })

  test('dispatch then cancel marks line as [~] with reason', async () => {
    const { store, worker, workspace, workspacePath } = setupWorkspace()
    const dispatch = await store.dispatchTask(workspace.id, worker.id, 'Build feature')
    store.cancelTask(workspace.id, dispatch.id, {
      fromAgentId: worker.id,
      reason: 'superseded',
    })
    const content = readTasks(workspacePath)
    const shortId = dispatch.id.slice(0, 8)
    expect(content).toContain(`- [~] **关羽** dispatch \`${shortId}\``)
    expect(content).toContain('⊘ superseded')
  })

  test('multiple dispatches append independent lines', async () => {
    const { store, workspace, workspacePath } = setupWorkspace()
    const worker1 = store.addWorker(workspace.id, {
      name: '张飞',
      role: 'coder',
    })
    const worker2 = store.addWorker(workspace.id, {
      name: '赵云',
      role: 'tester',
    })
    await store.dispatchTask(workspace.id, worker1.id, 'Task A')
    await store.dispatchTask(workspace.id, worker2.id, 'Task B')
    const content = readTasks(workspacePath)
    const dispatchLines = content?.split('\n').filter((l) => l.includes('dispatch')) ?? []
    expect(dispatchLines).toHaveLength(2)
    expect(dispatchLines.some((l) => l.includes('**张飞**') && l.includes('Task A'))).toBe(true)
    expect(dispatchLines.some((l) => l.includes('**赵云**') && l.includes('Task B'))).toBe(true)
  })

  test('rolls back dispatch ledger when tasks.md sent line cannot be written', async () => {
    const { services, worker, workspace, workspacePath } = setupServicesWorkspace()
    const tasksPath = join(workspacePath, HIVE_DIR_NAME, 'tasks.md')
    chmodSync(tasksPath, 0o444)

    try {
      await expect(
        services.teamOps.dispatchTask(workspace.id, worker.id, 'Write should fail')
      ).rejects.toThrow()

      expect(services.dispatchLedgerStore.listWorkspaceDispatches(workspace.id)).toEqual([])
    } finally {
      chmodSync(tasksPath, 0o644)
      services.db.close()
    }
  })

  test('removes the tasks.md sent line when a later dispatch side effect fails', async () => {
    const { services, worker, workspace, workspacePath } = setupServicesWorkspace()
    services.mobileChatWatchCallbacks.add(() => {
      throw new Error('mobile chat hook failed')
    })

    try {
      await expect(
        services.teamOps.dispatchTask(workspace.id, worker.id, 'Rollback orphan task')
      ).rejects.toThrow(/mobile chat hook failed/)

      expect(services.dispatchLedgerStore.listWorkspaceDispatches(workspace.id)).toEqual([])
      expect(readTasks(workspacePath)).not.toContain('Rollback orphan task')
      expect(readTasks(workspacePath)).not.toContain('dispatch `')
    } finally {
      services.db.close()
    }
  })

  test('report keeps the committed DB state when tasks.md done write fails', async () => {
    const { services, worker, workspace, workspacePath } = setupServicesWorkspace()
    const dispatch = await services.teamOps.dispatchTask(
      workspace.id,
      worker.id,
      'Report should tolerate stale tasks projection'
    )
    const tasksPath = join(workspacePath, HIVE_DIR_NAME, 'tasks.md')
    chmodSync(tasksPath, 0o444)

    try {
      expect(() =>
        services.teamOps.reportTask(workspace.id, worker.id, {
          dispatchId: dispatch.id,
          status: 'success',
          text: 'Done while tasks.md is stale',
        })
      ).not.toThrow()

      expect(services.dispatchLedgerStore.listWorkspaceDispatches(workspace.id)).toContainEqual(
        expect.objectContaining({
          id: dispatch.id,
          reportText: 'Done while tasks.md is stale',
          status: 'completed',
        })
      )
      expect(readTasks(workspacePath)).toContain(
        `- [ ] **关羽** dispatch \`${dispatch.id.slice(0, 8)}\``
      )
    } finally {
      chmodSync(tasksPath, 0o644)
      services.db.close()
    }
  })

  test('cancel keeps the committed DB state when tasks.md cancel write fails', async () => {
    const { services, worker, workspace, workspacePath } = setupServicesWorkspace()
    const dispatch = await services.teamOps.dispatchTask(
      workspace.id,
      worker.id,
      'Cancel should tolerate stale tasks projection'
    )
    const tasksPath = join(workspacePath, HIVE_DIR_NAME, 'tasks.md')
    chmodSync(tasksPath, 0o444)

    try {
      expect(() =>
        services.teamOps.cancelTask(workspace.id, dispatch.id, {
          fromAgentId: worker.id,
          reason: 'superseded while tasks.md is stale',
        })
      ).not.toThrow()

      expect(services.dispatchLedgerStore.listWorkspaceDispatches(workspace.id)).toContainEqual(
        expect.objectContaining({
          id: dispatch.id,
          reportText: 'superseded while tasks.md is stale',
          status: 'cancelled',
        })
      )
      expect(readTasks(workspacePath)).toContain(
        `- [ ] **关羽** dispatch \`${dispatch.id.slice(0, 8)}\``
      )
    } finally {
      chmodSync(tasksPath, 0o644)
      services.db.close()
    }
  })
})
