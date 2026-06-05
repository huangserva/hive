import { describe, expect, test } from 'vitest'

import type { TeamListItem } from '../../src/shared/types.js'
import type { TerminalRunSummary } from '../../web/src/api.js'
import { reconcileWorkerRuntimeStatuses } from '../../web/src/worker/reconcileWorkerRuntimeStatuses.js'

const worker = (overrides: Partial<TeamListItem>): TeamListItem => ({
  id: 'worker-1',
  name: 'Alice',
  pendingTaskCount: 0,
  role: 'coder',
  status: 'idle',
  ...overrides,
})

const run = (agentId: string): TerminalRunSummary => ({
  agent_id: agentId,
  agent_name: agentId,
  run_id: `run-${agentId}`,
  status: 'running',
  terminal_input_profile: 'default',
})

describe('reconcileWorkerRuntimeStatuses', () => {
  test('downgrades a stale idle worker to stopped when no PTY run exists', () => {
    expect(
      reconcileWorkerRuntimeStatuses([worker({ id: 'stale-idle', status: 'idle' })], [])
    ).toEqual([expect.objectContaining({ id: 'stale-idle', status: 'stopped' })])
  })

  test('keeps idle when the worker has a live or optimistic terminal run', () => {
    expect(
      reconcileWorkerRuntimeStatuses(
        [worker({ id: 'live-idle', status: 'idle' })],
        [run('live-idle')]
      )
    ).toEqual([expect.objectContaining({ id: 'live-idle', status: 'idle' })])
  })

  test('preserves queued pending count while downgrading stale working display to stopped', () => {
    expect(
      reconcileWorkerRuntimeStatuses(
        [worker({ id: 'queued', pendingTaskCount: 2, status: 'working' })],
        []
      )
    ).toEqual([expect.objectContaining({ id: 'queued', pendingTaskCount: 2, status: 'stopped' })])
  })
})
