import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type {
  AgentManager,
  AgentRunSnapshot,
  StartAgentInput,
} from '../../src/server/agent-manager.js'
import { createRuntimeStore } from '../../src/server/runtime-store.js'
import { initializeRuntimeDatabase } from '../../src/server/sqlite-schema.js'
import { createWorkspaceStore } from '../../src/server/workspace-store.js'

const tempDirs: string[] = []
const outputBus = {
  clear: () => {},
  publish: () => {},
  subscribe: () => () => {},
}

const createFakeAgentManager = (
  onStart?: (input: StartAgentInput, runs: Map<string, AgentRunSnapshot>) => void
): AgentManager => {
  const runs = new Map<string, AgentRunSnapshot>()

  return {
    getOutputBus() {
      return outputBus
    },
    pauseRun() {},
    resizeRun() {},
    resumeRun() {},
    getRun(runId) {
      const run = runs.get(runId)
      if (!run) {
        throw new Error(`Run not found: ${runId}`)
      }
      return run
    },
    removeRun(runId) {
      runs.delete(runId)
    },
    async startAgent(input) {
      const run = {
        agentId: input.agentId,
        exitCode: null,
        output: '',
        pid: 1,
        runId: `run-${input.agentId}`,
        status: 'starting' as const,
      }
      runs.set(run.runId, run)
      onStart?.(input, runs)
      return run
    },
    stopRun() {},
    writeInput() {},
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

describe('runtime store', () => {
  test('can create workspace', () => {
    const store = createRuntimeStore()

    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')

    expect(workspace).toMatchObject({
      name: 'Alpha',
      path: '/tmp/hive-alpha',
    })
  })

  test('createWorkspace does not mutate memory when DB insert fails', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-create-workspace-db-fail-'))
    tempDirs.push(dataDir)
    const db = new Database(join(dataDir, 'runtime.sqlite'))
    initializeRuntimeDatabase(db)
    const workspaceStore = createWorkspaceStore(db, [])
    const originalPrepare = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation((source: string) => {
      if (source.startsWith('INSERT INTO workspaces')) {
        throw new Error('insert workspace failed')
      }
      return originalPrepare(source)
    })

    expect(() => workspaceStore.createWorkspace('/tmp/hive-alpha', 'Alpha')).toThrow(
      /insert workspace failed/
    )
    expect(workspaceStore.listWorkspaces()).toEqual([])

    db.close()
  })

  test('each workspace automatically has one orchestrator', () => {
    const store = createRuntimeStore()

    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')
    const snapshot = store.getWorkspaceSnapshot(workspace.id)

    expect(snapshot.agents).toHaveLength(1)
    expect(snapshot.agents[0]).toMatchObject({
      name: 'Orchestrator',
      role: 'orchestrator',
      status: 'stopped',
      pendingTaskCount: 0,
    })
  })

  test('can add worker', () => {
    const store = createRuntimeStore()

    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')
    const worker = store.addWorker(workspace.id, {
      name: 'Alice',
      role: 'coder',
    })

    expect(worker).toMatchObject({
      workspaceId: workspace.id,
      name: 'Alice',
      role: 'coder',
      status: 'stopped',
      pendingTaskCount: 0,
    })
  })

  test('dispatchTask increments worker pending count and marks it working', () => {
    const store = createRuntimeStore()

    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')
    const worker = store.addWorker(workspace.id, {
      name: 'Alice',
      role: 'coder',
    })
    // Simulate PTY started: worker is idle, not stopped (spec §3.6.4 keeps
    // stopped workers from being silently promoted to working when their
    // PTY isn't actually running).
    store.getWorker(workspace.id, worker.id).status = 'idle'

    store.dispatchTask(workspace.id, worker.id, 'Implement feature')

    const updatedWorker = store.getWorker(workspace.id, worker.id)
    expect(updatedWorker.pendingTaskCount).toBe(1)
    expect(updatedWorker.status).toBe('working')
  })

  test('dispatchTask keeps a stopped worker stopped while accumulating queue', () => {
    const store = createRuntimeStore()

    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')
    const worker = store.addWorker(workspace.id, {
      name: 'Alice',
      role: 'coder',
    })
    // worker.addWorker initialises status='stopped' (PTY hasn't started).

    store.dispatchTask(workspace.id, worker.id, 'Implement feature')

    const updatedWorker = store.getWorker(workspace.id, worker.id)
    expect(updatedWorker.pendingTaskCount).toBe(1)
    expect(updatedWorker.status).toBe('stopped')
  })

  test('startAgent success promotes a fresh worker from stopped to idle', async () => {
    const store = createRuntimeStore({ agentManager: createFakeAgentManager() })
    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')
    const worker = store.addWorker(workspace.id, {
      name: 'Alice',
      role: 'coder',
    })
    store.configureAgentLaunch(workspace.id, worker.id, { command: '/bin/bash', args: [] })

    await store.startAgent(workspace.id, worker.id, { hivePort: '4010' })

    expect(store.getWorker(workspace.id, worker.id).status).toBe('idle')
  })

  test('startAgent success preserves queued pending tasks but resets status to idle', async () => {
    const store = createRuntimeStore({ agentManager: createFakeAgentManager() })
    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')
    const worker = store.addWorker(workspace.id, {
      name: 'Alice',
      role: 'coder',
    })
    store.dispatchTask(workspace.id, worker.id, 'Implement first feature')
    store.dispatchTask(workspace.id, worker.id, 'Implement second feature')
    store.configureAgentLaunch(workspace.id, worker.id, { command: '/bin/bash', args: [] })

    await store.startAgent(workspace.id, worker.id, { hivePort: '4010' })

    const restartedWorker = store.getWorker(workspace.id, worker.id)
    expect(restartedWorker.pendingTaskCount).toBe(2)
    expect(restartedWorker.status).toBe('idle')

    store.reportTask(workspace.id, worker.id, { status: 'success', text: 'First done' })
    const partiallyDrainedWorker = store.getWorker(workspace.id, worker.id)
    expect(partiallyDrainedWorker.pendingTaskCount).toBe(1)
    expect(partiallyDrainedWorker.status).toBe('working')

    store.reportTask(workspace.id, worker.id, { status: 'success', text: 'Second done' })
    const drainedWorker = store.getWorker(workspace.id, worker.id)
    expect(drainedWorker.pendingTaskCount).toBe(0)
    expect(drainedWorker.status).toBe('idle')
  })

  test('late real exit corrects fallback error/null across live run, persisted run, and worker summary', async () => {
    let startInput: StartAgentInput | undefined
    let agentRuns: Map<string, AgentRunSnapshot> | undefined
    const store = createRuntimeStore({
      agentManager: createFakeAgentManager((input, runs) => {
        startInput = input
        agentRuns = runs
      }),
    })
    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')
    const worker = store.addWorker(workspace.id, {
      name: 'Alice',
      role: 'coder',
    })
    store.configureAgentLaunch(workspace.id, worker.id, { command: '/bin/bash', args: [] })

    const run = await store.startAgent(workspace.id, worker.id, { hivePort: '4010' })
    if (!startInput) throw new Error('start input was not captured')
    const emitExit = (exitCode: number | null, errorTail?: string | null) => {
      const snapshot = agentRuns?.get(run.runId)
      if (!snapshot) throw new Error('run snapshot was not captured')
      snapshot.status = exitCode === 0 ? 'exited' : 'error'
      snapshot.exitCode = exitCode
      snapshot.errorTail = errorTail ?? null
      startInput?.onExit?.(
        errorTail === undefined
          ? { exitCode, runId: run.runId }
          : { errorTail, exitCode, runId: run.runId }
      )
    }

    emitExit(null, 'pty stream failed')
    expect(store.getLiveRun(run.runId)).toMatchObject({ status: 'error', exitCode: null })
    expect(store.listAgentRuns(worker.id)[0]).toMatchObject({
      status: 'error',
      exitCode: null,
    })
    expect(store.getWorker(workspace.id, worker.id).status).toBe('stopped')

    emitExit(0)

    expect(store.listAgentRuns(worker.id)[0]).toMatchObject({
      status: 'exited',
      exitCode: 0,
    })
    expect(store.getLiveRun(run.runId)).toMatchObject({ status: 'exited', exitCode: 0 })
    expect(store.getWorker(workspace.id, worker.id).status).toBe('stopped')
  })

  test('reportTask resets worker pending count and returns it to idle', () => {
    const store = createRuntimeStore()

    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')
    const worker = store.addWorker(workspace.id, {
      name: 'Alice',
      role: 'coder',
    })
    // Simulate PTY already running so dispatchTask can promote to working.
    store.getWorker(workspace.id, worker.id).status = 'idle'

    store.dispatchTask(workspace.id, worker.id, 'Implement feature')
    store.reportTask(workspace.id, worker.id, { status: 'success', text: 'Done' })

    const updatedWorker = store.getWorker(workspace.id, worker.id)
    expect(updatedWorker.pendingTaskCount).toBe(0)
    expect(updatedWorker.status).toBe('idle')
  })

  test('reportTask keeps a stopped worker stopped while draining pending count', () => {
    const store = createRuntimeStore()

    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')
    const worker = store.addWorker(workspace.id, {
      name: 'Alice',
      role: 'coder',
    })

    store.dispatchTask(workspace.id, worker.id, 'Implement feature')
    store.getWorker(workspace.id, worker.id).status = 'stopped'
    store.reportTask(workspace.id, worker.id, { status: 'success', text: 'Done' })

    const updatedWorker = store.getWorker(workspace.id, worker.id)
    expect(updatedWorker.pendingTaskCount).toBe(0)
    expect(updatedWorker.status).toBe('stopped')
  })

  test('listWorkers excludes orchestrator', () => {
    const store = createRuntimeStore()

    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')
    store.addWorker(workspace.id, {
      name: 'Alice',
      role: 'coder',
    })
    store.addWorker(workspace.id, {
      name: 'Bob',
      role: 'tester',
    })

    expect(store.listWorkers(workspace.id)).toEqual([
      {
        id: expect.any(String),
        name: 'Alice',
        role: 'coder',
        description: expect.any(String),
        status: 'stopped',
        pendingTaskCount: 0,
        workflowAllowed: false,
      },
      {
        id: expect.any(String),
        name: 'Bob',
        role: 'tester',
        description: expect.any(String),
        status: 'stopped',
        pendingTaskCount: 0,
        workflowAllowed: false,
      },
    ])
  })

  test('rejects duplicate worker names within the same workspace', () => {
    const store = createRuntimeStore()

    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')
    store.addWorker(workspace.id, {
      name: 'Alice',
      role: 'coder',
    })

    expect(() =>
      store.addWorker(workspace.id, {
        name: 'Alice',
        role: 'tester',
      })
    ).toThrow('Worker name already exists: Alice')
  })

  test('normalizes worker names on create before storing and matching duplicates', () => {
    const store = createRuntimeStore()
    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')

    const worker = store.addWorker(workspace.id, {
      name: ' Alice ',
      role: 'coder',
    })

    expect(worker.name).toBe('Alice')
    expect(store.listWorkers(workspace.id)).toContainEqual(
      expect.objectContaining({ id: worker.id, name: 'Alice' })
    )
    expect(() =>
      store.addWorker(workspace.id, {
        name: 'Alice',
        role: 'tester',
      })
    ).toThrow('Worker name already exists: Alice')
  })

  test('rejects blank worker names on create', () => {
    const store = createRuntimeStore()
    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')

    expect(() => store.addWorker(workspace.id, { name: '   ', role: 'coder' })).toThrow(
      'Worker name must not be empty'
    )
  })

  test('addWorker does not mutate memory when DB insert fails', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-add-worker-db-fail-'))
    tempDirs.push(dataDir)
    const db = new Database(join(dataDir, 'runtime.sqlite'))
    initializeRuntimeDatabase(db)
    const workspaceStore = createWorkspaceStore(db, [])
    const workspace = workspaceStore.createWorkspace('/tmp/hive-alpha', 'Alpha')
    const originalPrepare = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation((source: string) => {
      if (source.startsWith('INSERT INTO workers')) {
        throw new Error('insert worker failed')
      }
      return originalPrepare(source)
    })

    expect(() => workspaceStore.addWorker(workspace.id, { name: 'Alice', role: 'coder' })).toThrow(
      /insert worker failed/
    )
    expect(workspaceStore.listWorkers(workspace.id)).toEqual([])

    db.close()
  })
})
