import type { Database } from 'better-sqlite3'
import type { AgentSummary } from '../shared/types.js'
import { getDefaultRoleDescription } from './role-templates.js'
import type { WorkspaceRecord } from './workspace-store-contract.js'
import {
  createOrchestrator,
  type MessageKindRecord,
  type WorkerRow,
  type WorkspaceRow,
  type WorkspaceSummaryRow,
} from './workspace-store-support.js'

const createWorkerSummary = (
  workspaceId: string,
  row: Pick<WorkerRow, 'description' | 'id' | 'name' | 'role' | 'workflow_allowed'>
): AgentSummary => ({
  id: row.id,
  workspaceId,
  name: row.name,
  description: row.description ?? getDefaultRoleDescription(row.role),
  role: row.role,
  status: 'stopped',
  pendingTaskCount: 0,
  workflowAllowed: row.workflow_allowed === 1,
})

export const hydrateWorkspaceFromDb = (
  db: Database,
  workspaces: Map<string, WorkspaceRecord>,
  _messageKinds: MessageKindRecord[],
  workspaceId: string
) => {
  if (workspaces.has(workspaceId)) {
    return
  }

  const row = db.prepare('SELECT id, name, path FROM workspaces WHERE id = ?').get(workspaceId) as
    | WorkspaceSummaryRow
    | undefined
  if (!row) {
    return
  }

  workspaces.set(row.id, {
    summary: { id: row.id, name: row.name, path: row.path },
    agents: [createOrchestrator(row.id)],
  })

  for (const workerRow of db
    .prepare(
      'SELECT id, workspace_id, name, description, workflow_allowed, role FROM workers WHERE workspace_id = ? ORDER BY created_at ASC'
    )
    .all(workspaceId) as WorkerRow[]) {
    workspaces.get(workspaceId)?.agents.push(createWorkerSummary(workerRow.workspace_id, workerRow))
  }
}

export const seedWorkspacesFromDb = (
  db: Database,
  workspaces: Map<string, WorkspaceRecord>,
  _messageKinds: MessageKindRecord[]
) => {
  for (const row of db
    .prepare('SELECT id, name, path FROM workspaces ORDER BY created_at ASC')
    .all() as WorkspaceRow[]) {
    workspaces.set(row.id, {
      summary: { id: row.id, name: row.name, path: row.path },
      agents: [createOrchestrator(row.id)],
    })
  }

  for (const row of db
    .prepare(
      'SELECT id, workspace_id, name, description, workflow_allowed, role FROM workers ORDER BY created_at ASC'
    )
    .all() as WorkerRow[]) {
    workspaces.get(row.workspace_id)?.agents.push(createWorkerSummary(row.workspace_id, row))
  }
}
