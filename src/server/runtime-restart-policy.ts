import type { AgentRunStorePort } from './agent-runtime-ports.js'
import type { DispatchRecord } from './dispatch-ledger-store.js'
import type { MessageLogHandle, MessageLogRecord, RecoveryMessage } from './message-log-store.js'
import { createRestartPolicy } from './restart-policy.js'
import type { TasksFileService } from './tasks-file.js'
import type { WorkspaceStore } from './workspace-store.js'

// Narrow helper keeps runtime-store under the hard line cap.
export const buildRuntimeRestartPolicy = ({
  agentRunStore,
  listDispatches,
  messageLogStore,
  tasksFileService,
  workspaceStore,
}: {
  agentRunStore: Pick<AgentRunStorePort, 'listAgentRuns'>
  listDispatches: (workspaceId: string) => DispatchRecord[]
  messageLogStore: {
    insertMessage: (record: MessageLogRecord) => MessageLogHandle
    listMessagesForRecovery: (workspaceId: string, sinceMs: number) => RecoveryMessage[]
  }
  tasksFileService: Pick<TasksFileService, 'readTasks'>
  workspaceStore: Pick<WorkspaceStore, 'getWorkspaceSnapshot'>
}) =>
  createRestartPolicy({
    getWorkspaceSnapshot: workspaceStore.getWorkspaceSnapshot,
    insertMessage: messageLogStore.insertMessage,
    listAgentRuns: agentRunStore.listAgentRuns,
    listDispatches,
    listMessagesForRecovery: messageLogStore.listMessagesForRecovery,
    readTasks: tasksFileService.readTasks,
  })
