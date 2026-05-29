import type { WorkspaceSummary } from '../shared/types.js'
import type { AgentLaunchConfigInput } from './agent-run-store.js'
import { buildRecoverySummary } from './recovery-summary.js'
import {
  findPreviousRun,
  type RestartPolicyInput,
  writeSystemMessage,
} from './restart-policy-support.js'
import { createSystemRecoverySummaryMessage } from './runtime-message-builders.js'

const RECOVERY_WINDOW_MS = 60 * 60 * 1000

export interface RestartPolicy {
  injectPostStartMessage: (input: {
    agentId: string
    runId: string
    startConfig: AgentLaunchConfigInput
    workspace: WorkspaceSummary
    writeToRun: (runId: string, text: string) => void
  }) => boolean
}

export const createNoopRestartPolicy = (): RestartPolicy => ({
  injectPostStartMessage() {
    return false
  },
})

export const createRestartPolicy = ({
  getWorkspaceSnapshot,
  insertMessage,
  listAgentRuns,
  listDispatches,
  listMessagesForRecovery,
  readTasks,
}: RestartPolicyInput): RestartPolicy => ({
  injectPostStartMessage({ agentId, runId, startConfig, workspace, writeToRun }) {
    const previousRun = findPreviousRun(listAgentRuns(agentId), runId)
    if (!previousRun) return false

    const snapshot = getWorkspaceSnapshot(workspace.id)
    const agent = snapshot.agents.find((item) => item.id === agentId)
    if (!agent) return false
    const workers = snapshot.agents.filter(
      (item) => item.role !== 'orchestrator' && item.id !== agentId
    )
    const tasksContent = readTasks(snapshot.summary.path)

    if (startConfig.resumedSessionId) return true

    // 已取消的 dispatch 不该在恢复摘要里当成 open 任务复活（bug C2）。
    const cancelledDispatches = listDispatches(workspace.id)
      .filter((dispatch) => dispatch.status === 'cancelled')
      .map((dispatch) => ({ text: dispatch.text, toAgentId: dispatch.toAgentId }))

    const text = buildRecoverySummary({
      agent,
      allTaskMessages: listMessagesForRecovery(workspace.id, 0),
      cancelledDispatches,
      messages: listMessagesForRecovery(workspace.id, Date.now() - RECOVERY_WINDOW_MS),
      tasksContent,
      workers,
      workspace,
    })
    writeSystemMessage({
      insertMessage,
      record: createSystemRecoverySummaryMessage(workspace.id, agentId, text),
      runId,
      text,
      writeToRun,
    })
    return true
  },
})
