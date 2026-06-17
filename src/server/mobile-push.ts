import type { AIAction } from './cockpit-doc.js'
import type { RuntimeStore } from './runtime-store.js'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

interface ExpoPushTicket {
  details?: { error?: string }
  status?: string
}

interface ExpoPushResponse {
  data?: ExpoPushTicket | ExpoPushTicket[]
}

interface ExpoPushMessage {
  body: string
  data: Record<string, string>
  title: string
  to: string
}

export interface MobilePushService {
  notifyWorkerDone(
    workspaceId: string,
    workerName: string,
    taskSummary: string,
    dispatchId?: string
  ): Promise<void>
  notifyOrchestratorForwardFailure(
    workspaceId: string,
    info: {
      dispatchId: string | null
      error: string
      operation: 'cancel' | 'report' | 'status'
      workerName: string
    }
  ): Promise<void>
  notifyApprovalRequested(
    workspaceId: string,
    approval: {
      action: string
      approvalId: string
      risk: string
    }
  ): Promise<void>
  notifyHighAiAction(workspaceId: string, actionTitle: string): Promise<void>
  notifyStaleDispatch(
    workspaceId: string,
    info: {
      dispatchId: string
      escalated: boolean
      minutesAgo: number
      taskSummary: string
      workerName: string
    }
  ): Promise<void>
  notifyUnreviewedCode(
    workspaceId: string,
    info: {
      dispatchId: string
      minutesAgo: number
      taskSummary: string
      workerName: string
    }
  ): Promise<void>
}

export const createMobilePushService = (deps: {
  fetchImpl?: typeof fetch
  store: Pick<RuntimeStore, 'clearMobilePushToken' | 'listMobileDevices'>
}): MobilePushService => {
  const fetchImpl = deps.fetchImpl ?? fetch
  const sentDispatchIds = new Set<string>()
  const sentApprovalIds = new Set<string>()
  const sentStaleKeys = new Set<string>()
  const sentUnreviewedIds = new Set<string>()

  const recipients = () =>
    deps.store
      .listMobileDevices()
      .filter((device) => device.revoked_at === null && device.push_token)
      .map((device) => device.push_token as string)

  const send = async (messages: ExpoPushMessage[]) => {
    if (messages.length === 0) return
    try {
      const response = await fetchImpl(EXPO_PUSH_URL, {
        body: JSON.stringify(messages),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      })
      if (!response.ok) return
      const body = (await response.json()) as ExpoPushResponse
      const tickets = Array.isArray(body.data) ? body.data : body.data ? [body.data] : []
      for (const [index, ticket] of tickets.entries()) {
        if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          const token = messages[index]?.to
          if (token) deps.store.clearMobilePushToken(token)
        }
      }
    } catch {
      // Push notifications are best-effort and must not affect runtime behavior.
    }
  }

  return {
    async notifyWorkerDone(workspaceId, workerName, taskSummary, dispatchId) {
      if (dispatchId) {
        if (sentDispatchIds.has(dispatchId)) return
        sentDispatchIds.add(dispatchId)
      }
      await send(
        recipients().map((token) => ({
          body: taskSummary,
          data: { type: 'worker_done', workspaceId },
          title: `${workerName} completed a task`,
          to: token,
        }))
      )
    },
    async notifyOrchestratorForwardFailure(workspaceId, info) {
      await send(
        recipients().map((token) => ({
          body: `${info.workerName} ${info.operation} 已记录，但 Orchestrator 未收到：${info.error}`,
          data: {
            ...(info.dispatchId ? { dispatchId: info.dispatchId } : {}),
            operation: info.operation,
            type: 'orchestrator_forward_failed',
            workspaceId,
          },
          title: 'Orchestrator missed a team update',
          to: token,
        }))
      )
    },
    async notifyApprovalRequested(workspaceId, approval) {
      if (sentApprovalIds.has(approval.approvalId)) return
      sentApprovalIds.add(approval.approvalId)
      await send(
        recipients().map((token) => ({
          body: approval.action,
          data: {
            action: approval.action,
            approvalId: approval.approvalId,
            type: 'approval',
            workspaceId,
          },
          title: 'Approval required',
          to: token,
        }))
      )
    },
    async notifyHighAiAction(workspaceId, actionTitle) {
      await send(
        recipients().map((token) => ({
          body: actionTitle,
          data: { type: 'high_ai_action', workspaceId },
          title: 'HippoTeam needs attention',
          to: token,
        }))
      )
    },
    async notifyStaleDispatch(workspaceId, info) {
      // Dedupe per dispatch per tier so a stale dispatch pushes at most once when it
      // crosses stale, and once more if it escalates.
      const key = `${info.dispatchId}:${info.escalated ? 'escalated' : 'stale'}`
      if (sentStaleKeys.has(key)) return
      sentStaleKeys.add(key)
      const title = info.escalated ? 'Dispatch still unreported' : 'Worker may be stuck — no report'
      const prefix = info.escalated ? 'Ignored reminders: ' : 'No report yet: '
      await send(
        recipients().map((token) => ({
          body: `${prefix}${info.workerName} · "${info.taskSummary}" (~${info.minutesAgo}m)`,
          data: {
            dispatchId: info.dispatchId,
            escalated: String(info.escalated),
            type: 'stale_dispatch',
            workspaceId,
          },
          title,
          to: token,
        }))
      )
    },
    async notifyUnreviewedCode(workspaceId, info) {
      // 每条 dispatch 只推一次：从"有代码改动未审"跨阈值时通知一次，never-silent 的硬兜底。
      if (sentUnreviewedIds.has(info.dispatchId)) return
      sentUnreviewedIds.add(info.dispatchId)
      await send(
        recipients().map((token) => ({
          body: `Unreviewed code: ${info.workerName} · "${info.taskSummary}" (~${info.minutesAgo}m) — 派 reviewer 审`,
          data: {
            dispatchId: info.dispatchId,
            type: 'unreviewed_code',
            workspaceId,
          },
          title: 'Code change not reviewed',
          to: token,
        }))
      )
    },
  }
}

export const createHighAiActionNotifier = (
  pushService: Pick<MobilePushService, 'notifyHighAiAction'>
) => {
  const sentActionIds = new Set<string>()
  return async (
    workspaceId: string,
    actions: Array<Pick<AIAction, 'id' | 'priority' | 'text'>>
  ) => {
    for (const action of actions) {
      if (action.priority !== 'high') continue
      const key = `${workspaceId}:${action.id}`
      if (sentActionIds.has(key)) continue
      sentActionIds.add(key)
      await pushService.notifyHighAiAction(workspaceId, action.text)
    }
  }
}
