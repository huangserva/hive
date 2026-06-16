import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { type AgentManager, createAgentManager } from '../../src/server/agent-manager.js'
import { reconcileAgentStatus } from '../../src/server/agent-status-reconciler.js'
import {
  createRuntimeStoreLifecycle,
  createRuntimeStoreServices,
} from '../../src/server/runtime-store-helpers.js'

const tempDirs: string[] = []
const lifecycles: Array<ReturnType<typeof createRuntimeStoreLifecycle>> = []

afterEach(async () => {
  while (lifecycles.length > 0) await lifecycles.pop()?.close()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const setup = () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hive-agent-status-reconcile-data-'))
  tempDirs.push(dataDir)
  const workspacePath = mkdtempSync(join(tmpdir(), 'hive-agent-status-reconcile-ws-'))
  tempDirs.push(workspacePath)
  const services = createRuntimeStoreServices({ dataDir })
  const workspace = services.workspaceStore.createWorkspace(workspacePath, 'Status Reconcile')
  const worker = services.workspaceStore.addWorker(workspace.id, { name: '关羽', role: 'coder' })
  return { services, worker, workspace }
}

const createDelayedStartAgentManager = (manager = createAgentManager()) => {
  let releaseStart: (() => void) | undefined
  const startGate = new Promise<void>((resolve) => {
    releaseStart = resolve
  })
  const delayedManager: AgentManager = {
    getOutputBus: manager.getOutputBus,
    getRun: manager.getRun,
    pauseRun: manager.pauseRun,
    removeRun: manager.removeRun,
    resizeRun: manager.resizeRun,
    resumeRun: manager.resumeRun,
    stopRun: manager.stopRun,
    writeInput: manager.writeInput,
    async startAgent(input) {
      await startGate
      return manager.startAgent(input)
    },
  }
  return {
    delayedManager,
    releaseStart: () => releaseStart?.(),
  }
}

describe('agent status reconcile with real stores', () => {
  test('corrects a fake-working worker to stopped when getActiveRunByAgentId has no live run', () => {
    const { services, worker, workspace } = setup()
    services.dispatchLedgerStore.createDispatch({
      fromAgentId: `${workspace.id}:orchestrator`,
      text: 'stuck task',
      toAgentId: worker.id,
      workspaceId: workspace.id,
    })
    const staleWorker = services.workspaceStore.getWorker(workspace.id, worker.id)
    staleWorker.status = 'working'
    staleWorker.pendingTaskCount = 1
    expect(services.workspaceStore.getWorker(workspace.id, worker.id).status).toBe('working')

    reconcileAgentStatus({
      agent: services.workspaceStore.getWorker(workspace.id, worker.id),
      getActiveRunByAgentId: () => undefined,
      listOpenDispatchesForWorker: services.dispatchLedgerStore.listOpenDispatchesForWorker,
      workspaceId: workspace.id,
    })

    const reconciled = services.workspaceStore.getWorker(workspace.id, worker.id)
    expect(reconciled.status).toBe('stopped')
    expect(reconciled.pendingTaskCount).toBe(0)
    expect(
      services.dispatchLedgerStore.listOpenDispatchesForWorker(workspace.id, worker.id)
    ).toHaveLength(1)
  })

  test('keeps a live worker with open dispatch working', () => {
    const { services, worker, workspace } = setup()
    services.dispatchLedgerStore.createDispatch({
      fromAgentId: `${workspace.id}:orchestrator`,
      text: 'active task',
      toAgentId: worker.id,
      workspaceId: workspace.id,
    })

    reconcileAgentStatus({
      agent: services.workspaceStore.getWorker(workspace.id, worker.id),
      getActiveRunByAgentId: () => ({ runId: 'run-1' }),
      listOpenDispatchesForWorker: services.dispatchLedgerStore.listOpenDispatchesForWorker,
      workspaceId: workspace.id,
    })

    const reconciled = services.workspaceStore.getWorker(workspace.id, worker.id)
    expect(reconciled.status).toBe('working')
    expect(reconciled.pendingTaskCount).toBe(1)
  })

  test('derives working then idle from dispatch ledger open count for a live worker', () => {
    const { services, worker, workspace } = setup()
    const dispatch = services.dispatchLedgerStore.createDispatch({
      fromAgentId: `${workspace.id}:orchestrator`,
      text: 'finish this task',
      toAgentId: worker.id,
      workspaceId: workspace.id,
    })
    const reconcileLiveWorker = () =>
      reconcileAgentStatus({
        agent: services.workspaceStore.getWorker(workspace.id, worker.id),
        getActiveRunByAgentId: () => ({ runId: 'run-1' }),
        listOpenDispatchesForWorker: services.dispatchLedgerStore.listOpenDispatchesForWorker,
        workspaceId: workspace.id,
      })

    reconcileLiveWorker()
    expect(services.workspaceStore.getWorker(workspace.id, worker.id)).toMatchObject({
      pendingTaskCount: 1,
      status: 'working',
    })

    services.dispatchLedgerStore.markReportedByWorker({
      artifacts: [],
      dispatchId: dispatch.id,
      reportText: 'done',
      toAgentId: worker.id,
      workspaceId: workspace.id,
    })
    reconcileLiveWorker()

    expect(services.workspaceStore.getWorker(workspace.id, worker.id)).toMatchObject({
      pendingTaskCount: 0,
      status: 'idle',
    })
  })

  test('sentinel reconcile does not stop a worker while agent start is pending', async () => {
    const delayed = createDelayedStartAgentManager()
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-agent-status-reconcile-data-'))
    tempDirs.push(dataDir)
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-agent-status-reconcile-ws-'))
    tempDirs.push(workspacePath)
    const script = join(workspacePath, 'long-running.js')
    writeFileSync(script, 'process.stdin.resume(); setInterval(() => {}, 1000)\n')
    const services = createRuntimeStoreServices({
      agentManager: delayed.delayedManager,
      dataDir,
    })
    const lifecycle = createRuntimeStoreLifecycle({
      agentManager: delayed.delayedManager,
      services,
    })
    lifecycles.push(lifecycle)
    const workspace = services.workspaceStore.createWorkspace(workspacePath, 'Pending Start')
    const worker = services.workspaceStore.addWorker(workspace.id, { name: '关羽', role: 'coder' })
    lifecycle.configureAgentLaunch(workspace.id, worker.id, {
      args: [script],
      command: process.execPath,
    })
    services.dispatchLedgerStore.createDispatch({
      fromAgentId: `${workspace.id}:orchestrator`,
      text: 'pending start task',
      toAgentId: worker.id,
      workspaceId: workspace.id,
    })

    const startPromise = lifecycle.startAgent(workspace.id, worker.id, { hivePort: '4010' })
    try {
      await services.sentinelHeartbeat?.tick()

      const duringStart = services.workspaceStore.getWorker(workspace.id, worker.id)
      expect(duringStart.status).toBe('working')
      expect(duringStart.pendingTaskCount).toBe(1)
    } finally {
      delayed.releaseStart()
    }

    const run = await startPromise
    services.workspaceStore.markTaskDispatched(workspace.id, worker.id)
    await services.sentinelHeartbeat?.tick()

    const afterStart = services.workspaceStore.getWorker(workspace.id, worker.id)
    expect(run.runId).toBeTruthy()
    expect(afterStart.status).toBe('working')
    expect(afterStart.pendingTaskCount).toBe(1)
  })

  test('startup hydration does not restore stopped workers with phantom pending counts', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-agent-status-reconcile-data-'))
    tempDirs.push(dataDir)
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-agent-status-reconcile-ws-'))
    tempDirs.push(workspacePath)
    const firstServices = createRuntimeStoreServices({ dataDir })
    const workspace = firstServices.workspaceStore.createWorkspace(workspacePath, 'Hydration')
    const worker = firstServices.workspaceStore.addWorker(workspace.id, {
      name: '张飞',
      role: 'coder',
    })
    firstServices.dispatchLedgerStore.createDispatch({
      fromAgentId: `${workspace.id}:orchestrator`,
      text: 'open task before restart',
      toAgentId: worker.id,
      workspaceId: workspace.id,
    })
    firstServices.db.close()

    const secondServices = createRuntimeStoreServices({ dataDir })
    try {
      const hydrated = secondServices.workspaceStore.getWorker(workspace.id, worker.id)
      expect(hydrated.status).toBe('stopped')
      expect(hydrated.pendingTaskCount).toBe(0)
      expect(
        secondServices.dispatchLedgerStore.listOpenDispatchesForWorker(workspace.id, worker.id)
      ).toHaveLength(1)
    } finally {
      secondServices.db.close()
    }
  })
})
