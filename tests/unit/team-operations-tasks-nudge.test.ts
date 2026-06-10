import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

import type { DispatchRecord } from '../../src/server/dispatch-ledger-store.js'
import { createTasksFileService } from '../../src/server/tasks-file.js'
import { createTeamOperations } from '../../src/server/team-operations.js'
import type { AgentSummary } from '../../src/shared/types.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const setupWorkspacePath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-team-nudge-'))
  tempDirs.push(dir)
  mkdirSync(join(dir, '.hive'), { recursive: true })
  writeFileSync(
    join(dir, '.hive', 'tasks.md'),
    ['# Tasks', '', '## In progress', '', '> Current sprint: M18 cleanup', '', '## Done'].join(
      '\n'
    ),
    'utf8'
  )
  writeFileSync(
    join(dir, '.hive', 'plan.md'),
    ['## 里程碑', '', '### M18 · shipped 2026-05-20', '', '### M19 · in_progress'].join('\n'),
    'utf8'
  )
  return dir
}

const createDispatch = (workspaceId: string, workerId: string, text: string) =>
  ({
    artifacts: [],
    createdAt: Date.now(),
    deliveredAt: null,
    fromAgentId: null,
    id: '12345678-aaaa-bbbb-cccc-dddddddddddd',
    reportedAt: null,
    reportText: null,
    sequence: 1,
    status: 'queued' as const,
    submittedAt: null,
    text,
    toAgentId: workerId,
    workspaceId,
  }) satisfies DispatchRecord

const setupOps = (input: { role?: AgentSummary['role'] } = {}) => {
  const workspacePath = setupWorkspacePath()
  const workspaceId = 'workspace-1'
  const worker: AgentSummary = {
    description: 'Coder',
    id: 'worker-1',
    name: '关羽',
    pendingTaskCount: 0,
    role: input.role ?? 'coder',
    status: 'stopped',
    workspaceId,
  }
  const writeTasksNarrativeNudgePrompt = vi.fn()
  const dispatches: ReturnType<typeof createDispatch>[] = []
  const ops = createTeamOperations({
    agentRuntime: {
      writeTasksNarrativeNudgePrompt,
    } as never,
    createDispatch: vi.fn((dispatchInput) => {
      const dispatch = createDispatch(
        dispatchInput.workspaceId,
        dispatchInput.toAgentId,
        dispatchInput.text
      )
      dispatches.push(dispatch)
      return dispatch
    }),
    deleteDispatch: vi.fn(),
    deleteMessage: vi.fn(),
    findOpenDispatch: vi.fn(),
    findOpenDispatchById: vi.fn(),
    insertMessage: vi.fn(() => ({ sequence: 1 })),
    listOpenDispatchesForWorkspace: vi.fn((): DispatchRecord[] => []),
    markDispatchCancelled: vi.fn(),
    markDispatchReportedByWorker: vi.fn(),
    markDispatchSubmitted: vi.fn(),
    tasksFileService: createTasksFileService(),
    workspaceStore: {
      getAgent: vi.fn(),
      getWorker: vi.fn(() => worker),
      getWorkerByName: vi.fn(() => worker),
      getWorkspaceSnapshot: vi.fn(() => ({
        agents: [worker],
        summary: { id: workspaceId, name: 'Workspace', path: workspacePath },
      })),
      markTaskDispatched: vi.fn(),
    } as never,
  })

  return { ops, workspaceId, worker, workspacePath, writeTasksNarrativeNudgePrompt }
}

describe('team operations tasks narrative nudge', () => {
  test('injects an orchestrator nudge after first dispatch for a new milestone', async () => {
    const { ops, workspaceId, worker, writeTasksNarrativeNudgePrompt } = setupOps()

    await ops.dispatchTask(workspaceId, worker.id, 'M19a: wire cockpit action')

    expect(writeTasksNarrativeNudgePrompt).toHaveBeenCalledWith(
      workspaceId,
      expect.stringContaining('M19a 首次 dispatch')
    )
  })

  test('deduplicates the same rule and milestone within one team-operations session', async () => {
    const { ops, workspaceId, worker, writeTasksNarrativeNudgePrompt } = setupOps()

    await ops.dispatchTask(workspaceId, worker.id, 'M19a: first task')
    await ops.dispatchTask(workspaceId, worker.id, 'M19a: second task')

    expect(writeTasksNarrativeNudgePrompt).toHaveBeenCalledTimes(1)
  })

  test('does not nudge when dispatch target is a sentinel worker', async () => {
    const { ops, workspaceId, worker, workspacePath, writeTasksNarrativeNudgePrompt } = setupOps({
      role: 'sentinel',
    })

    await ops.dispatchTask(workspaceId, worker.id, 'M19a: sentinel observation')

    expect(writeTasksNarrativeNudgePrompt).not.toHaveBeenCalled()
    expect(readFileSync(join(workspacePath, '.hive', 'tasks.md'), 'utf8')).toContain(
      '**关羽** dispatch `12345678`'
    )
  })
})
