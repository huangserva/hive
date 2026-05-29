import type { AgentSummary, WorkspaceSummary } from '../shared/types.js'
import type { PersistedAgentRun } from './agent-run-store.js'
import type { DispatchRecord } from './dispatch-ledger-store.js'
import type { MessageLogHandle, MessageLogRecord, RecoveryMessage } from './message-log-store.js'

export interface RestartPolicyInput {
  getWorkspaceSnapshot: (workspaceId: string) => {
    agents: AgentSummary[]
    summary: WorkspaceSummary
  }
  insertMessage: (record: MessageLogRecord) => MessageLogHandle
  listAgentRuns: (agentId: string) => PersistedAgentRun[]
  // 取整个 workspace 的 dispatch（含 cancelled），用于恢复时剔除已取消任务（bug C2）。
  listDispatches: (workspaceId: string) => DispatchRecord[]
  listMessagesForRecovery: (workspaceId: string, sinceMs: number) => RecoveryMessage[]
  readTasks: (workspacePath: string) => string
}

export const findPreviousRun = (runs: PersistedAgentRun[], currentRunId: string) =>
  runs.find((run) => run.runId !== currentRunId)

export const writeSystemMessage = ({
  insertMessage,
  record,
  runId,
  text,
  writeToRun,
}: {
  insertMessage: RestartPolicyInput['insertMessage']
  record: MessageLogRecord
  runId: string
  text: string
  writeToRun: (runId: string, text: string) => void
}) => {
  // 先把 recovery summary 写进 PTY，确认没有同步抛错（如 PTY 已失活）后再落库。
  // 否则注入实际失败时仍写出"已成功恢复"记录，造成假象（bug C3）。
  writeToRun(runId, text)
  insertMessage(record)
}
