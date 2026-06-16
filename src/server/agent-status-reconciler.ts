import type { AgentStatus, AgentSummary } from '../shared/types.js'

type ActiveRunRef = { runId: string } | undefined

interface DeriveAgentStatusInput {
  activeRun: ActiveRunRef
  isStarting?: boolean
  openDispatchCount: number
}

export const deriveAgentStatus = ({
  activeRun,
  isStarting = false,
  openDispatchCount,
}: DeriveAgentStatusInput): AgentStatus => {
  if (!activeRun && !isStarting) return 'stopped'
  return openDispatchCount > 0 ? 'working' : 'idle'
}

export const deriveAgentPendingTaskCount = ({
  activeRun,
  isStarting = false,
  openDispatchCount,
}: DeriveAgentStatusInput): number => {
  if (!activeRun && !isStarting) return 0
  return openDispatchCount
}

interface ReconcileAgentStatusInput {
  agent: AgentSummary
  getActiveRunByAgentId: (workspaceId: string, agentId: string) => ActiveRunRef
  isAgentStarting?: (workspaceId: string, agentId: string) => boolean
  listOpenDispatchesForWorker: (workspaceId: string, agentId: string) => unknown[]
  workspaceId: string
}

export const reconcileAgentStatus = ({
  agent,
  getActiveRunByAgentId,
  isAgentStarting = () => false,
  listOpenDispatchesForWorker,
  workspaceId,
}: ReconcileAgentStatusInput) => {
  const activeRun = getActiveRunByAgentId(workspaceId, agent.id)
  const isStarting = isAgentStarting(workspaceId, agent.id)
  const openDispatchCount = listOpenDispatchesForWorker(workspaceId, agent.id).length
  const status = deriveAgentStatus({ activeRun, isStarting, openDispatchCount })
  const pendingTaskCount = deriveAgentPendingTaskCount({ activeRun, isStarting, openDispatchCount })
  agent.status = status
  agent.pendingTaskCount = pendingTaskCount
  return { pendingTaskCount, status }
}
