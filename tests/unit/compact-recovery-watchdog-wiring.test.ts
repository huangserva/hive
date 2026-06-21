import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

import type {
  AgentManager,
  AgentRunSnapshot,
  StartAgentInput,
} from '../../src/server/agent-manager.js'
import {
  DEFAULT_COMPACT_HARD_RECOVERY_MS,
  DEFAULT_COMPACT_SOFT_PROBE_GRACE_MS,
} from '../../src/server/compact-recovery-watchdog.js'
import {
  createRuntimeStoreLifecycle,
  createRuntimeStoreServices,
} from '../../src/server/runtime-store-helpers.js'
import { HIVE_DIR_NAME } from '../../src/server/tasks-file.js'

const tempDirs: string[] = []

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const outputBus = {
  clear: () => {},
  publish: () => {},
  subscribe: () => () => {},
}

const createWatchdogWiringAgentManager = () => {
  const runs = new Map<string, AgentRunSnapshot>()
  const startInputs = new Map<string, StartAgentInput>()
  const stoppedRuns: string[] = []
  const writtenInputs: Array<{ input: string; runId: string }> = []
  let sequence = 0
  const manager: AgentManager = {
    getOutputBus: () => outputBus,
    getRun: (runId) => {
      const run = runs.get(runId)
      if (!run) throw new Error(`Run not found: ${runId}`)
      return run
    },
    pauseRun: () => {},
    removeRun: (runId) => {
      runs.delete(runId)
    },
    resizeRun: () => {},
    resumeRun: () => {},
    startAgent: async (input) => {
      sequence += 1
      const run: AgentRunSnapshot = {
        agentId: input.agentId,
        exitCode: null,
        output: '',
        pid: sequence,
        runId: `run-${sequence}`,
        status: 'running',
      }
      runs.set(run.runId, run)
      startInputs.set(run.runId, input)
      return run
    },
    stopRun: (runId) => {
      stoppedRuns.push(runId)
      // Production timing: stopRequested is set on the live run by runtime,
      // while the manager snapshot remains running until the PTY exits.
    },
    writeInput: (runId, input) => {
      writtenInputs.push({ input: input.toString(), runId })
    },
  }
  return {
    finishRuns() {
      for (const [runId, input] of startInputs) input.onExit?.({ exitCode: 0, runId })
    },
    manager,
    stoppedRuns,
    writtenInputs,
  }
}

describe('compact recovery watchdog runtime wiring', () => {
  test('restarts and replays when stopRequested is set but manager status is still running', async () => {
    process.env.HIVE_COMPACT_AUTORECOVER = '1'
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1_000))
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-compact-wiring-data-'))
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-compact-wiring-ws-'))
    tempDirs.push(dataDir, workspacePath)
    mkdirSync(join(workspacePath, HIVE_DIR_NAME), { recursive: true })
    writeFileSync(
      join(workspacePath, HIVE_DIR_NAME, 'tasks.md'),
      '## In progress\n\n## Open\n\n## Done\n',
      'utf8'
    )
    const agentManager = createWatchdogWiringAgentManager()
    const services = createRuntimeStoreServices({ agentManager: agentManager.manager, dataDir })
    const lifecycle = createRuntimeStoreLifecycle({
      agentManager: agentManager.manager,
      services,
    })
    try {
      const workspace = services.workspaceStore.createWorkspace(workspacePath, 'Compact Wiring')
      const worker = services.workspaceStore.addWorker(workspace.id, {
        name: 'Alice',
        role: 'coder',
      })
      lifecycle.configureAgentLaunch(workspace.id, worker.id, { args: [], command: '/bin/bash' })
      const firstRun = await lifecycle.startAgent(workspace.id, worker.id, { hivePort: '4010' })
      const dispatch = await services.teamOps.dispatchTask(
        workspace.id,
        worker.id,
        'Recover compact-stalled worker',
        { hivePort: '4010' }
      )

      await vi.advanceTimersByTimeAsync(60_000)
      await vi.advanceTimersByTimeAsync(DEFAULT_COMPACT_HARD_RECOVERY_MS)
      await vi.advanceTimersByTimeAsync(DEFAULT_COMPACT_SOFT_PROBE_GRACE_MS)

      expect(agentManager.stoppedRuns).toEqual([firstRun.runId])
      expect(agentManager.writtenInputs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            input: expect.stringContaining('compact recovery replay'),
            runId: 'run-2',
          }),
        ])
      )
      expect(agentManager.writtenInputs.at(-1)?.input).toContain(dispatch.id)
    } finally {
      agentManager.finishRuns()
      vi.useRealTimers()
      await lifecycle.close()
    }
  })
})
