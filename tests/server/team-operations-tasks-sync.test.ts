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

  test('cancel without an active worker keeps the dispatch open and tasks line pending', async () => {
    const { store, worker, workspace, workspacePath } = setupWorkspace()
    const dispatch = await store.dispatchTask(workspace.id, worker.id, 'Build feature')
    const result = store.cancelTask(workspace.id, dispatch.id, {
      fromAgentId: worker.id,
      reason: 'superseded',
    })
    const content = readTasks(workspacePath)
    const shortId = dispatch.id.slice(0, 8)
    expect(result).toMatchObject({
      dispatch: expect.objectContaining({ id: dispatch.id, status: 'queued' }),
      forwarded: false,
      forwardError: expect.stringContaining('No active run'),
    })
    expect(store.listDispatches(workspace.id)).toContainEqual(
      expect.objectContaining({
        id: dispatch.id,
        reportText: null,
        status: 'queued',
      })
    )
    expect(content).toContain(`- [ ] **关羽** dispatch \`${shortId}\``)
    expect(content).not.toContain('⊘ superseded')
    expect(
      store
        .listMobileChatMessages(workspace.id)
        .some(
          (message) =>
            message.message_type === 'system_event' &&
            JSON.parse(message.content_json).type === 'orchestrator_forward_failed'
        )
    ).toBe(true)
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

  test('persists a system event when dispatch spawn fails before rollback', async () => {
    const { store, worker, workspace } = setupWorkspace()
    store.configureAgentLaunch(workspace.id, worker.id, {
      args: [],
      command: '/definitely/not/a/real/binary',
    })

    await expect(
      store.dispatchTask(workspace.id, worker.id, 'Spawn should leave a diagnostic event', {
        hivePort: '4010',
      })
    ).rejects.toThrow('/definitely/not/a/real/binary CLI not found in PATH')

    expect(store.listDispatches(workspace.id)).toEqual([])
    const events = store
      .listMobileChatMessages(workspace.id)
      .filter((message) => message.message_type === 'system_event')
      .map((message) => JSON.parse(message.content_json) as Record<string, unknown>)
    expect(events).toContainEqual(
      expect.objectContaining({
        command: '/definitely/not/a/real/binary',
        dispatch_id: expect.any(String),
        event: 'dispatch_spawn_failed',
        path: expect.stringContaining('/'),
        worker: '关羽',
      })
    )
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

  test('cancel keeps the dispatch open when the cancel prompt is not delivered even if tasks.md is readonly', async () => {
    const { services, worker, workspace, workspacePath } = setupServicesWorkspace()
    const dispatch = await services.teamOps.dispatchTask(
      workspace.id,
      worker.id,
      'Cancel should tolerate stale tasks projection'
    )
    const tasksPath = join(workspacePath, HIVE_DIR_NAME, 'tasks.md')
    chmodSync(tasksPath, 0o444)

    try {
      const result = services.teamOps.cancelTask(workspace.id, dispatch.id, {
        fromAgentId: worker.id,
        reason: 'superseded while tasks.md is stale',
      })

      expect(services.dispatchLedgerStore.listWorkspaceDispatches(workspace.id)).toContainEqual(
        expect.objectContaining({
          id: dispatch.id,
          reportText: null,
          status: 'queued',
        })
      )
      expect(result).toMatchObject({
        dispatch: expect.objectContaining({ id: dispatch.id, status: 'queued' }),
        forwarded: false,
        forwardError: expect.stringContaining('No active run'),
      })
      expect(readTasks(workspacePath)).toContain(
        `- [ ] **关羽** dispatch \`${dispatch.id.slice(0, 8)}\``
      )
    } finally {
      chmodSync(tasksPath, 0o644)
      services.db.close()
    }
  })
})
