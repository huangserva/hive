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
  data: { type: string; workspaceId: string }
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
  notifyHighAiAction(workspaceId: string, actionTitle: string): Promise<void>
}

export const createMobilePushService = (deps: {
  fetchImpl?: typeof fetch
  store: Pick<RuntimeStore, 'clearMobilePushToken' | 'listMobileDevices'>
}): MobilePushService => {
  const fetchImpl = deps.fetchImpl ?? fetch
  const sentDispatchIds = new Set<string>()

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
