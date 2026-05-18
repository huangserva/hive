import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'

import type { AgentStatus, AgentSummary, TeamListItem } from '../shared/types.js'
import {
  countOpenDispatchesByWorker,
  countOpenDispatchesForWorker,
} from './dispatch-ledger-store.js'
import { ConflictError } from './http-errors.js'
import { getDefaultRoleDescription } from './role-templates.js'
import type { WorkerInput, WorkspaceRecord, WorkspaceStore } from './workspace-store-contract.js'
import { hydrateWorkspaceFromDb, seedWorkspacesFromDb } from './workspace-store-hydration.js'
import {
  getAgentRecord,
  getWorkerByNameRecord,
  getWorkerRecord,
  markAgentStarted,
  markAgentStopped,
  markTaskDispatched,
  markTaskReported,
} from './workspace-store-mutations.js'
import { createOrchestrator, isWorkerAgent } from './workspace-store-support.js'

export type { WorkerInput, WorkspaceRecord, WorkspaceStore }

const deriveWorkerStatus = (worker: AgentSummary, openCount: number): AgentStatus => {
  if (worker.status === 'stopped') return 'stopped'
  return openCount > 0 ? 'working' : 'idle'
}

const openDispatchCountMap = (db: Database, workspaceId: string) => {
  const counts = new Map<string, number>()
  for (const row of countOpenDispatchesByWorker(db, workspaceId)) {
    counts.set(row.worker_id, row.open_count)
  }
  return counts
}

const normalizeWorkerName = (name: string) => {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Worker name must not be empty')
  if (trimmed.length > 64) throw new Error('Worker name must be 64 characters or fewer')
  return trimmed
}

export const createWorkspaceStore = (db: Database): WorkspaceStore => {
  const workspaces = new Map<string, WorkspaceRecord>()
  seedWorkspacesFromDb(db, workspaces)

  const getWorkspace = (workspaceId: string) => {
    hydrateWorkspaceFromDb(db, workspaces, workspaceId)
    const workspace = workspaces.get(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    return workspace
  }

  const decorateAgent = (workspaceId: string, agent: AgentSummary): AgentSummary => {
    if (!isWorkerAgent(agent)) return agent
    const pendingTaskCount = countOpenDispatchesForWorker(db, workspaceId, agent.id)
    return {
      ...agent,
      pendingTaskCount,
      status: deriveWorkerStatus(agent, pendingTaskCount),
    }
  }

  const decorateWorkspace = (workspace: WorkspaceRecord): WorkspaceRecord => ({
    summary: workspace.summary,
    agents: workspace.agents.map((agent) => decorateAgent(workspace.summary.id, agent)),
  })

  return {
    addWorker(workspaceId, input) {
      const workspace = getWorkspace(workspaceId)
      const name = normalizeWorkerName(input.name)
      if (workspace.agents.some((agent) => agent.name === name && isWorkerAgent(agent))) {
        throw new ConflictError(`Worker name already exists: ${name}`)
      }
      const worker: AgentSummary = {
        id: randomUUID(),
        workspaceId,
        name,
        description: input.description ?? getDefaultRoleDescription(input.role),
        role: input.role,
        status: 'stopped',
        pendingTaskCount: 0,
      }
      db.prepare(
        'INSERT INTO workers (id, workspace_id, name, description, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(worker.id, workspaceId, worker.name, worker.description, worker.role, Date.now())
      workspace.agents.push(worker)
      return worker
    },
    createWorkspace(path, name) {
      const summary = { id: randomUUID(), name, path }
      db.prepare('INSERT INTO workspaces (id, name, path, created_at) VALUES (?, ?, ?, ?)').run(
        summary.id,
        name,
        path,
        Date.now()
      )
      workspaces.set(summary.id, { summary, agents: [createOrchestrator(summary.id)] })
      return summary
    },
    deleteWorkspace(workspaceId) {
      const workspace = getWorkspace(workspaceId)
      const agentIds = workspace.agents.map((agent) => agent.id)
      db.transaction(() => {
        db.prepare('DELETE FROM messages WHERE workspace_id = ?').run(workspaceId)
        db.prepare('DELETE FROM agent_launch_configs WHERE workspace_id = ?').run(workspaceId)
        db.prepare('DELETE FROM agent_sessions WHERE workspace_id = ?').run(workspaceId)
        const deleteAgentRuns = db.prepare('DELETE FROM agent_runs WHERE agent_id = ?')
        for (const agentId of agentIds) deleteAgentRuns.run(agentId)
        db.prepare('DELETE FROM workers WHERE workspace_id = ?').run(workspaceId)
        db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId)
      })()
      workspaces.delete(workspaceId)
    },
    renameWorker(workspaceId, workerId, name) {
      const worker = getWorkerRecord(workspaces, workspaceId, workerId)
      const trimmed = normalizeWorkerName(name)
      if (trimmed === worker.name) return worker
      const workspace = getWorkspace(workspaceId)
      if (
        workspace.agents.some(
          (agent) => agent.id !== workerId && agent.name === trimmed && isWorkerAgent(agent)
        )
      ) {
        throw new ConflictError(`Worker name already exists: ${trimmed}`)
      }
      db.prepare('UPDATE workers SET name = ? WHERE workspace_id = ? AND id = ?').run(
        trimmed,
        workspaceId,
        workerId
      )
      worker.name = trimmed
      return worker
    },
    deleteWorker(workspaceId, workerId) {
      const workspace = getWorkspace(workspaceId)
      getWorkerRecord(workspaces, workspaceId, workerId)
      db.transaction(() => {
        db.prepare('DELETE FROM messages WHERE workspace_id = ? AND worker_id = ?').run(
          workspaceId,
          workerId
        )
        db.prepare('DELETE FROM agent_launch_configs WHERE workspace_id = ? AND agent_id = ?').run(
          workspaceId,
          workerId
        )
        db.prepare('DELETE FROM agent_sessions WHERE workspace_id = ? AND agent_id = ?').run(
          workspaceId,
          workerId
        )
        db.prepare('DELETE FROM agent_runs WHERE agent_id = ?').run(workerId)
        db.prepare('DELETE FROM workers WHERE workspace_id = ? AND id = ?').run(
          workspaceId,
          workerId
        )
      })()
      workspace.agents = workspace.agents.filter((agent) => agent.id !== workerId)
    },
    getAgent(workspaceId, agentId) {
      getWorkspace(workspaceId)
      return decorateAgent(workspaceId, getAgentRecord(workspaces, workspaceId, agentId))
    },
    getWorker(workspaceId, workerId) {
      getWorkspace(workspaceId)
      return decorateAgent(workspaceId, getWorkerRecord(workspaces, workspaceId, workerId))
    },
    getWorkerByName(workspaceId, workerName) {
      getWorkspace(workspaceId)
      return decorateAgent(workspaceId, getWorkerByNameRecord(workspaces, workspaceId, workerName))
    },
    getWorkspaceSnapshot: (workspaceId) => decorateWorkspace(getWorkspace(workspaceId)),
    hasAgent(workspaceId, agentId) {
      hydrateWorkspaceFromDb(db, workspaces, workspaceId)
      return workspaces.get(workspaceId)?.agents.some((agent) => agent.id === agentId) ?? false
    },
    listWorkers(workspaceId) {
      const counts = openDispatchCountMap(db, workspaceId)
      return getWorkspace(workspaceId)
        .agents.filter(isWorkerAgent)
        .map((worker): TeamListItem => {
          const pendingTaskCount = counts.get(worker.id) ?? 0
          return {
            id: worker.id,
            name: worker.name,
            role: worker.role,
            status: deriveWorkerStatus(worker, pendingTaskCount),
            pendingTaskCount,
          }
        })
    },
    listWorkspaces() {
      return Array.from(workspaces.values(), (workspace) => workspace.summary)
    },
    markAgentStarted: (workspaceId, agentId) => markAgentStarted(workspaces, workspaceId, agentId),
    markAgentStopped: (workspaceId, agentId) => markAgentStopped(workspaces, workspaceId, agentId),
    markTaskDispatched: (workspaceId, workerId) =>
      markTaskDispatched(workspaces, workspaceId, workerId),
    markTaskReported: (workspaceId, workerId) =>
      markTaskReported(workspaces, workspaceId, workerId),
  }
}
