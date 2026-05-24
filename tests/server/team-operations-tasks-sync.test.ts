import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { createAgentManager } from '../../src/server/agent-manager.js'
import { createRuntimeStore } from '../../src/server/runtime-store.js'
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
    commandPresetId: 'claude',
  })

  return { store, worker, workspace, workspacePath }
}

const readTasks = (workspacePath: string) => {
  const path = join(workspacePath, HIVE_DIR_NAME, 'tasks.md')
  return existsSync(path) ? readFileSync(path, 'utf8') : null
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
    store.reportTask(workspace.id, worker.id, 'Done', 'done')
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
      commandPresetId: 'claude',
    })
    const worker2 = store.addWorker(workspace.id, {
      name: '赵云',
      role: 'tester',
      commandPresetId: 'claude',
    })
    await store.dispatchTask(workspace.id, worker1.id, 'Task A')
    await store.dispatchTask(workspace.id, worker2.id, 'Task B')
    const content = readTasks(workspacePath)
    const dispatchLines = content?.split('\n').filter((l) => l.includes('dispatch'))
    expect(dispatchLines).toHaveLength(2)
    expect(dispatchLines.some((l) => l.includes('**张飞**') && l.includes('Task A'))).toBe(true)
    expect(dispatchLines.some((l) => l.includes('**赵云**') && l.includes('Task B'))).toBe(true)
  })
})
