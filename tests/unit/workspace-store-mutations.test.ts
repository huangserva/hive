import { describe, expect, test } from 'vitest'

import type { WorkspaceRecord } from '../../src/server/workspace-store-contract.js'
import {
  markAgentStarted,
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
  test('markAgentStarted resets a stopped worker with queued pending tasks to idle', () => {
    const workspaces = createWorkspaceMap()

    markTaskDispatched(workspaces, 'workspace-1', 'worker-1')
    markTaskDispatched(workspaces, 'workspace-1', 'worker-1')
    expect(workspaces.get('workspace-1')?.agents[0]).toMatchObject({
      pendingTaskCount: 2,
      status: 'stopped',
    })

    markAgentStarted(workspaces, 'workspace-1', 'worker-1')

    expect(workspaces.get('workspace-1')?.agents[0]).toMatchObject({
      pendingTaskCount: 2,
      status: 'idle',
    })
  })

  test('markAgentStarted resets a running worker with backlog to idle without clearing count', () => {
    const workspaces = createWorkspaceMap()

    markAgentStarted(workspaces, 'workspace-1', 'worker-1')
    markTaskDispatched(workspaces, 'workspace-1', 'worker-1')
    expect(workspaces.get('workspace-1')?.agents[0]).toMatchObject({
      pendingTaskCount: 1,
      status: 'working',
    })

    markAgentStarted(workspaces, 'workspace-1', 'worker-1')

    expect(workspaces.get('workspace-1')?.agents[0]).toMatchObject({
      pendingTaskCount: 1,
      status: 'idle',
    })
  })

  test('markAgentStarted promotes a stopped worker with no queue to idle', () => {
    const workspaces = createWorkspaceMap()

    markAgentStarted(workspaces, 'workspace-1', 'worker-1')

    expect(workspaces.get('workspace-1')?.agents[0]).toMatchObject({
      pendingTaskCount: 0,
      status: 'idle',
    })
  })

  test('dispatch and report keep counts correct after a stopped queued worker starts', () => {
    const workspaces = createWorkspaceMap()

    markTaskDispatched(workspaces, 'workspace-1', 'worker-1')
    markTaskDispatched(workspaces, 'workspace-1', 'worker-1')
    markAgentStarted(workspaces, 'workspace-1', 'worker-1')

    markTaskReported(workspaces, 'workspace-1', 'worker-1')
    expect(workspaces.get('workspace-1')?.agents[0]).toMatchObject({
      pendingTaskCount: 1,
      status: 'working',
    })

    markTaskReported(workspaces, 'workspace-1', 'worker-1')
    expect(workspaces.get('workspace-1')?.agents[0]).toMatchObject({
      pendingTaskCount: 0,
      status: 'idle',
    })
  })
})
