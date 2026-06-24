import type { AIAction } from './cockpit-doc.js'
import type { SentinelAlert } from './sentinel-rules.js'

export const buildSentinelAlertActions = (alerts: SentinelAlert[]): AIAction[] =>
  alerts
    .filter((alert) => alert.tier === 'warn' || alert.tier === 'critical')
    .map((alert) => ({
      action: alert.tier === 'critical' ? '立即处理' : '查看',
      id: `sentinel-alert:${alert.dedupeKey}`,
      priority: 'high',
      targetTab: 'tasks',
      text: `${alert.title} — ${alert.detail}；建议：${alert.suggestedAction}`,
      type: 'sentinel_alert',
    }))

export const createSentinelAlertStore = () => {
  const alertsByWorkspaceId = new Map<string, Map<string, SentinelAlert>>()

  return {
    listWorkspaceAlerts(workspaceId: string): SentinelAlert[] {
      return [...(alertsByWorkspaceId.get(workspaceId)?.values() ?? [])].sort((left, right) =>
        left.dedupeKey.localeCompare(right.dedupeKey)
      )
    },
    replaceWorkspaceAlerts(workspaceId: string, alerts: SentinelAlert[]) {
      if (alerts.length === 0) {
        alertsByWorkspaceId.delete(workspaceId)
        return
      }
      alertsByWorkspaceId.set(workspaceId, new Map(alerts.map((alert) => [alert.dedupeKey, alert])))
    },
  }
}

export const augmentAiActionsWithSentinelAlerts = (
  baseActions: AIAction[],
  alerts: SentinelAlert[]
): AIAction[] => {
  const actions = buildSentinelAlertActions(alerts)
  return actions.length === 0 ? baseActions : [...actions, ...baseActions]
}
