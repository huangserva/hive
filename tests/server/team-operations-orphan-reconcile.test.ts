import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

import type { LiveAgentRun } from '../../src/server/agent-runtime-types.js'
import { createRuntimeStoreServices } from '../../src/server/runtime-store-helpers.js'
import { HIVE_DIR_NAME } from '../../src/server/tasks-file.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const setup = () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hive-orphan-data-'))
  tempDirs.push(dataDir)
  const workspacePath = mkdtempSync(join(tmpdir(), 'hive-orphan-ws-'))
  tempDirs.push(workspacePath)
  mkdirSync(join(workspacePath, HIVE_DIR_NAME), { recursive: true })
  writeFileSync(
    join(workspacePath, HIVE_DIR_NAME, 'tasks.md'),
    '## In progress\n\n## Open\n\n## Done\n',
    'utf8'
  )

  const services = createRuntimeStoreServices({ dataDir })
  const workspace = services.workspaceStore.createWorkspace(workspacePath, 'Orphan Test')
  const worker = services.workspaceStore.addWorker(workspace.id, { name: '关羽', role: 'coder' })

  return { services, worker, workspace, workspacePath }
}

const readTasks = (workspacePath: string) => {
  const path = join(workspacePath, HIVE_DIR_NAME, 'tasks.md')
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

const createLiveRunRef = (runId: string): LiveAgentRun =>
  ({
    agentId: 'worker-1',
    exitCode: null,
    output: '',
    pid: 1234,
    runId,
    startedAt: Date.now(),
    status: 'running',
  }) satisfies LiveAgentRun

// 把一条 dispatch 推到 running 态：先经 teamOps.dispatchTask（写 tasks.md sent 行 + queued），
// 再用真实 ledger 的 markSubmitted 翻成 running。worker 从未启动，status 维持 'stopped'。
const seedSubmittedDispatch = async (
  services: ReturnType<typeof createRuntimeStoreServices>,
  workspaceId: string,
  workerId: string,
  text: string
) => {
  const dispatch = await services.teamOps.dispatchTask(workspaceId, workerId, text)
  expect(dispatch.status).toBe('queued')
  services.dispatchLedgerStore.markSubmitted(dispatch.id)
  return dispatch
}

describe('cancelTask supports active dispatches', () => {
  test('cancelTask cancels a running dispatch (not only queued)', async () => {
    const { services, worker, workspace, workspacePath } = setup()
    const dispatch = await seedSubmittedDispatch(services, workspace.id, worker.id, 'Stuck task')
    expect(
      services.dispatchLedgerStore.findOpenDispatchById(workspace.id, dispatch.id)?.status
    ).toBe('running')

    const result = services.teamOps.cancelTask(workspace.id, dispatch.id, {
      fromAgentId: worker.id,
      reason: 'manual cleanup',
    })

    expect(result.dispatch?.status).toBe('cancelled')
    expect(services.dispatchLedgerStore.findOpenDispatchById(workspace.id, dispatch.id)).toBe(
      undefined
    )
    const content = readTasks(workspacePath)
    expect(content).toContain(`- [~] **关羽** dispatch \`${dispatch.id.slice(0, 8)}\``)
    expect(content).toContain('manual cleanup')
  })
})

describe('reconcileOrphanedDispatches', () => {
  test('marks a stale running dispatch orphaned when the worker is stopped, syncing tasks.md', async () => {
    const { services, worker, workspace, workspacePath } = setup()
    const dispatch = await seedSubmittedDispatch(services, workspace.id, worker.id, 'Orphan task')

    // worker 从未启动 → stopped 且无 active run；staleMs:0 表示已过期。
    const reconciled = services.teamOps.reconcileOrphanedDispatches({ staleMs: 0 })

    expect(reconciled.map((d) => d.id)).toEqual([dispatch.id])
    expect(reconciled[0]?.status).toBe('orphaned')
    expect(reconciled[0]?.reportText).toContain('orphan-submitted')
    expect(services.dispatchLedgerStore.findOpenDispatchById(workspace.id, dispatch.id)).toBe(
      undefined
    )
    const content = readTasks(workspacePath)
    expect(content).toContain(`- [~] **关羽** dispatch \`${dispatch.id.slice(0, 8)}\``)
    expect(content).toContain('orphan-submitted')
  })

  test('leaves an in-flight running dispatch alone when the worker is not stopped', async () => {
    const { services, worker, workspace } = setup()
    const dispatch = await seedSubmittedDispatch(services, workspace.id, worker.id, 'Active task')

    // active run 是合法在途的权威信号；状态投影由 reconciler 派生，不能靠 mark* 伪造。
    vi.spyOn(services.agentRuntime, 'getActiveRunByAgentId').mockReturnValue(
      createLiveRunRef('run-1')
    )

    const reconciled = services.teamOps.reconcileOrphanedDispatches({ staleMs: 0 })

    expect(reconciled).toEqual([])
    expect(
      services.dispatchLedgerStore.findOpenDispatchById(workspace.id, dispatch.id)?.status
    ).toBe('running')
  })

  test('does not orphan a fresh running dispatch within the staleness window', async () => {
    const { services, worker, workspace } = setup()
    const dispatch = await seedSubmittedDispatch(services, workspace.id, worker.id, 'Fresh task')

    // 默认 15 分钟阈值，now≈submittedAt → 未过期，不动（防误杀刚派出/正在 resume 的任务）。
    const reconciled = services.teamOps.reconcileOrphanedDispatches({})

    expect(reconciled).toEqual([])
    expect(
      services.dispatchLedgerStore.findOpenDispatchById(workspace.id, dispatch.id)?.status
    ).toBe('running')
  })

  test('ignores queued (never-submitted) dispatches', async () => {
    const { services, worker, workspace } = setup()
    // queued：从未注入 worker，不属于 submitted 孤儿场景。
    const dispatch = await services.teamOps.dispatchTask(workspace.id, worker.id, 'Queued task')
    expect(dispatch.status).toBe('queued')

    const reconciled = services.teamOps.reconcileOrphanedDispatches({ staleMs: 0 })

    expect(reconciled).toEqual([])
    expect(
      services.dispatchLedgerStore.findOpenDispatchById(workspace.id, dispatch.id)?.status
    ).toBe('queued')
  })

  test('scopes reconcile to a single workspace when workspaceId is given', async () => {
    const { services, worker, workspace, workspacePath } = setup()
    const otherWorkspacePath = mkdtempSync(join(tmpdir(), 'hive-orphan-ws2-'))
    tempDirs.push(otherWorkspacePath)
    mkdirSync(join(otherWorkspacePath, HIVE_DIR_NAME), { recursive: true })
    writeFileSync(
      join(otherWorkspacePath, HIVE_DIR_NAME, 'tasks.md'),
      '## In progress\n\n## Open\n\n## Done\n',
      'utf8'
    )
    const otherWorkspace = services.workspaceStore.createWorkspace(otherWorkspacePath, 'Other')
    const otherWorker = services.workspaceStore.addWorker(otherWorkspace.id, {
      name: '张飞',
      role: 'coder',
    })

    const dispatch = await seedSubmittedDispatch(services, workspace.id, worker.id, 'A orphan')
    const otherDispatch = await seedSubmittedDispatch(
      services,
      otherWorkspace.id,
      otherWorker.id,
      'B orphan'
    )

    const reconciled = services.teamOps.reconcileOrphanedDispatches({
      staleMs: 0,
      workspaceId: workspace.id,
    })

    expect(reconciled.map((d) => d.id)).toEqual([dispatch.id])
    // 另一 workspace 的孤儿不受影响。
    expect(
      services.dispatchLedgerStore.findOpenDispatchById(otherWorkspace.id, otherDispatch.id)?.status
    ).toBe('running')
    expect(readTasks(workspacePath)).toContain('orphan-submitted')
  })
})
