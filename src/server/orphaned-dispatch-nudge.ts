import type { AgentSummary } from '../shared/types.js'
import type { DispatchRecord } from './dispatch-ledger-store.js'

interface NotifyOrphanedDispatchesInput {
  injectNudge: (workspaceId: string, message: string) => void
  listOpenDispatchesForWorker: (workspaceId: string, workerId: string) => DispatchRecord[]
  worker: AgentSummary
  workspaceId: string
}

const formatSubmittedAt = (value: number | null) =>
  value === null ? 'none' : new Date(value).toISOString()

export const buildOrphanedDispatchNudgeMessage = (
  worker: AgentSummary,
  dispatches: DispatchRecord[]
) =>
  [
    '[Hive 系统消息：worker 退出但有未完成 dispatch]',
    `Worker ${worker.name} 已停止，以下 dispatch 仍处于 open 状态：`,
    ...dispatches.map(
      (dispatch) =>
        `- dispatch_id=${dispatch.id}, status=${dispatch.status}, submitted_at=${formatSubmittedAt(dispatch.submittedAt)}`
    ),
    '请检查工作是否已完成（查看 git log），如已完成可手动 close；如未完成考虑重启 worker。',
  ].join('\n')

export const notifyOrphanedDispatchesOnWorkerExit = ({
  injectNudge,
  listOpenDispatchesForWorker,
  worker,
  workspaceId,
}: NotifyOrphanedDispatchesInput) => {
  if (worker.role === 'orchestrator') return
  const openDispatches = listOpenDispatchesForWorker(workspaceId, worker.id)
  if (openDispatches.length === 0) return
  injectNudge(workspaceId, buildOrphanedDispatchNudgeMessage(worker, openDispatches))
}
