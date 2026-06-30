import type { WorkspaceSummary } from '../shared/types.js'
import { type DispatchRecord, isCompletedDispatchStatus } from './dispatch-ledger-store.js'
import type { HiveLogger } from './logger.js'

const DEFAULT_CHECK_INTERVAL_MS = 60 * 1000
const DEFAULT_REPORT_ACK_STALE_MS = 90 * 1000

export interface StalledReportNudgeOptions {
  injectNudge: (workspaceId: string, message: string) => void
  intervalMs?: number
  listDispatchesForWorkspace: (workspaceId: string) => DispatchRecord[]
  listWorkspaces: () => WorkspaceSummary[]
  logger?: HiveLogger
  now?: () => number
  reportAckStaleMs?: number
  startupAt?: number
}

const formatReportedAt = (value: number | null) =>
  value === null ? 'unknown' : new Date(value).toISOString()

export const buildUnacknowledgedReportNudgeMessage = (
  dispatches: Array<{
    dispatchId: string
    minutesAgo: number
    reason: string
    reportedAt: number | null
    workerId: string
  }>
) =>
  [
    '[Hive 系统消息：worker report 回灌未确认]',
    '以下 dispatch 已收到 worker report，但 Orchestrator 尚未确认收到回灌输入。请不要假设 orch 已看到结果或会继续派下一单：',
    ...dispatches.map(
      (dispatch) =>
        `- dispatch_id=${dispatch.dispatchId}, worker_id=${dispatch.workerId}, reported_at=${formatReportedAt(dispatch.reportedAt)}（约 ${dispatch.minutesAgo} 分钟前）, reason=${dispatch.reason}`
    ),
    '建议查看 orchestrator 终端；如处于 compact/busy，请等待或人工恢复，避免重复执行 worker 已完成的任务。',
    '（本提醒不会自动重投 report，避免重复回灌。）',
  ].join('\n')

export const createStalledReportNudge = ({
  injectNudge,
  intervalMs = DEFAULT_CHECK_INTERVAL_MS,
  listDispatchesForWorkspace,
  listWorkspaces,
  logger,
  now = Date.now,
  reportAckStaleMs = DEFAULT_REPORT_ACK_STALE_MS,
  startupAt,
}: StalledReportNudgeOptions) => {
  let timer: ReturnType<typeof setInterval> | null = null
  const nudgedDispatchIds = new Set<string>()
  const trackingStartedAt = startupAt ?? now()

  const findUnacknowledgedReports = (workspaceId: string, tickedAt: number) =>
    listDispatchesForWorkspace(workspaceId).flatMap((dispatch) => {
      if (!isCompletedDispatchStatus(dispatch.status)) return []
      if (dispatch.reportedAt === null) return []
      if (dispatch.reportAcknowledgedAt !== null && dispatch.reportAcknowledgedAt !== undefined) {
        return []
      }
      if (nudgedDispatchIds.has(dispatch.id)) return []
      const explicitFailure =
        dispatch.reportDeliveryFailedAt !== null && dispatch.reportDeliveryFailedAt !== undefined
      if (!explicitFailure && dispatch.reportedAt < trackingStartedAt) return []
      const age = tickedAt - dispatch.reportedAt
      if (!explicitFailure && age < reportAckStaleMs) return []
      return [
        {
          dispatch,
          minutesAgo: Math.floor(age / 60_000),
          reason: explicitFailure ? 'report_delivery_failed' : 'report_ack_timeout',
        },
      ]
    })

  const tick = () => {
    const tickedAt = now()
    for (const workspace of listWorkspaces()) {
      try {
        const unacknowledged = findUnacknowledgedReports(workspace.id, tickedAt)
        if (unacknowledged.length === 0) continue
        injectNudge(
          workspace.id,
          buildUnacknowledgedReportNudgeMessage(
            unacknowledged.map(({ dispatch, minutesAgo, reason }) => ({
              dispatchId: dispatch.id,
              minutesAgo,
              reason,
              reportedAt: dispatch.reportedAt,
              workerId: dispatch.toAgentId,
            }))
          )
        )
        for (const { dispatch } of unacknowledged) nudgedDispatchIds.add(dispatch.id)
      } catch (error) {
        logger?.warn(`stalled report nudge failed workspace_id=${workspace.id}`, error)
      }
    }
  }

  const start = () => {
    if (timer) return
    timer = setInterval(() => {
      tick()
    }, intervalMs)
    const maybeUnref = timer as unknown as { unref?: () => void }
    maybeUnref.unref?.()
  }

  const stop = () => {
    if (!timer) return
    clearInterval(timer)
    timer = null
  }

  return { close: stop, start, stop, tick }
}
