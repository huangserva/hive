import { describe, expect, test } from 'vitest'

import type { WorkspaceRecord } from '../../src/server/workspace-store-contract.js'
import {
  markAgentStarted,
  markAgentStopped,
  markTaskCancelled,
  markTaskDispatched,
  markTaskReported,
} from '../../src/server/workspace-store-mutations.js'

const createWorkspaceRecord = (): WorkspaceRecord => ({
  agents: [
    {
      description: '',
      id: 'worker-1',
      name: 'Alice',
      pendingTaskCount: 0,
      role: 'coder',
      status: 'stopped',
      workflowAllowed: false,
      workspaceId: 'workspace-1',
    },
  ],
  summary: {
    id: 'workspace-1',
    name: 'Alpha',
    path: '/tmp/hive-alpha',
  },
})

const createWorkspaceMap = () => {
  const workspace = createWorkspaceRecord()
  return new Map([[workspace.summary.id, workspace]])
}

describe('workspace store mutations', () => {
  test('markAgentStarted validates the agent but does not project status', () => {
    const workspaces = createWorkspaceMap()
    const worker = workspaces.get('workspace-1')?.agents[0]
    if (!worker) throw new Error('missing worker fixture')
    worker.pendingTaskCount = 2
    worker.status = 'stopped'

    markAgentStarted(workspaces, 'workspace-1', 'worker-1')

    expect(workspaces.get('workspace-1')?.agents[0]).toMatchObject({
      pendingTaskCount: 2,
      status: 'stopped',
    })
  })

  test('markAgentStopped validates the agent but does not project status', () => {
    const workspaces = createWorkspaceMap()
    const worker = workspaces.get('workspace-1')?.agents[0]
    if (!worker) throw new Error('missing worker fixture')
    worker.pendingTaskCount = 1
    worker.status = 'working'

    markAgentStopped(workspaces, 'workspace-1', 'worker-1')

    expect(workspaces.get('workspace-1')?.agents[0]).toMatchObject({
      pendingTaskCount: 1,
      status: 'working',
    })
  })

  test('task marks validate the worker but do not maintain an independent pending counter', () => {
    const workspaces = createWorkspaceMap()
    const worker = workspaces.get('workspace-1')?.agents[0]
    if (!worker) throw new Error('missing worker fixture')
    worker.status = 'idle'

    markTaskDispatched(workspaces, 'workspace-1', 'worker-1')
    markTaskReported(workspaces, 'workspace-1', 'worker-1')
    markTaskCancelled(workspaces, 'workspace-1', 'worker-1')

    expect(workspaces.get('workspace-1')?.agents[0]).toMatchObject({
      pendingTaskCount: 0,
      status: 'idle',
    })
  })

  test('mark helpers still fail for missing agents and workers', () => {
    const workspaces = createWorkspaceMap()

    expect(() => markAgentStarted(workspaces, 'workspace-1', 'missing')).toThrow(/Agent not found/)
    expect(() => markTaskDispatched(workspaces, 'workspace-1', 'missing')).toThrow(
      /Agent not found/
    )
  })
})
