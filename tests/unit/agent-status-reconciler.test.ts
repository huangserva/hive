import { describe, expect, test } from 'vitest'

import {
  deriveAgentPendingTaskCount,
  deriveAgentStatus,
  reconcileAgentStatus,
} from '../../src/server/agent-status-reconciler.js'
import type { AgentSummary } from '../../src/shared/types.js'

const worker = (overrides: Partial<AgentSummary> = {}): AgentSummary => ({
  description: 'Coder',
  id: 'worker-1',
  name: '关羽',
  pendingTaskCount: 1,
  role: 'coder',
  status: 'working',
  workspaceId: 'workspace-1',
  workflowAllowed: false,
  ...overrides,
})

describe('deriveAgentStatus', () => {
  test('marks a dead worker stopped and clears pending task count', () => {
    expect(deriveAgentStatus({ activeRun: undefined, openDispatchCount: 1 })).toBe('stopped')
    expect(deriveAgentPendingTaskCount({ activeRun: undefined, openDispatchCount: 1 })).toBe(0)
  })

  test('keeps a live worker with open dispatches working', () => {
    expect(deriveAgentStatus({ activeRun: { runId: 'run-1' }, openDispatchCount: 1 })).toBe(
      'working'
    )
    expect(
      deriveAgentPendingTaskCount({ activeRun: { runId: 'run-1' }, openDispatchCount: 1 })
    ).toBe(1)
  })

  test('marks a live worker without open dispatches idle', () => {
    expect(deriveAgentStatus({ activeRun: { runId: 'run-1' }, openDispatchCount: 0 })).toBe('idle')
    expect(
      deriveAgentPendingTaskCount({ activeRun: { runId: 'run-1' }, openDispatchCount: 0 })
    ).toBe(0)
  })

  test('treats a pending start as alive before a run enters the live registry', () => {
    expect(
      deriveAgentStatus({ activeRun: undefined, isStarting: true, openDispatchCount: 1 })
    ).toBe('working')
    expect(
      deriveAgentPendingTaskCount({ activeRun: undefined, isStarting: true, openDispatchCount: 1 })
    ).toBe(1)
  })
})

describe('reconcileAgentStatus', () => {
  test('writes stopped projection when active run disappeared from getActiveRunByAgentId', () => {
    const agent = worker({ pendingTaskCount: 2, status: 'working' })

    const result = reconcileAgentStatus({
      agent,
      getActiveRunByAgentId: () => undefined,
      isAgentStarting: () => false,
      listOpenDispatchesForWorker: () => [{ id: 'dispatch-1' }, { id: 'dispatch-2' }],
      workspaceId: agent.workspaceId,
    })

    expect(result).toEqual({ pendingTaskCount: 0, status: 'stopped' })
    expect(agent.status).toBe('stopped')
    expect(agent.pendingTaskCount).toBe(0)
  })

  test('does not downshift a live worker with open dispatches', () => {
    const agent = worker({ pendingTaskCount: 1, status: 'working' })

    const result = reconcileAgentStatus({
      agent,
      getActiveRunByAgentId: () => ({ runId: 'run-1' }),
      isAgentStarting: () => false,
      listOpenDispatchesForWorker: () => [{ id: 'dispatch-1' }],
      workspaceId: agent.workspaceId,
    })

    expect(result).toEqual({ pendingTaskCount: 1, status: 'working' })
    expect(agent.status).toBe('working')
    expect(agent.pendingTaskCount).toBe(1)
  })
})
