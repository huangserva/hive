import { describe, expect, test } from 'vitest'

import {
  buildSentinelAlertActions,
  createSentinelAlertStore,
} from '../../src/server/sentinel-alert-status.js'
import type { SentinelAlert } from '../../src/server/sentinel-rules.js'

const alert = (
  input: Partial<SentinelAlert> & Pick<SentinelAlert, 'dedupeKey' | 'title'>
): SentinelAlert => ({
  dedupeKey: input.dedupeKey,
  detail: input.detail ?? 'detail',
  ruleId: input.ruleId ?? 'R1',
  suggestedAction: input.suggestedAction ?? 'check worker',
  tier: input.tier ?? 'warn',
  title: input.title,
  workspaceId: input.workspaceId ?? 'workspace-1',
})

describe('buildSentinelAlertActions', () => {
  test('turns warn and critical sentinel alerts into high priority Cockpit actions', () => {
    const actions = buildSentinelAlertActions([
      alert({ dedupeKey: 'info', tier: 'info', title: 'FYI' }),
      alert({ dedupeKey: 'warn', tier: 'warn', title: 'Spawn failed' }),
      alert({ dedupeKey: 'critical', tier: 'critical', title: 'Deadlock' }),
    ])

    expect(actions).toEqual([
      expect.objectContaining({
        id: 'sentinel-alert:warn',
        priority: 'high',
        targetTab: 'tasks',
        type: 'sentinel_alert',
      }),
      expect.objectContaining({
        id: 'sentinel-alert:critical',
        priority: 'high',
        text: expect.stringContaining('Deadlock'),
      }),
    ])
  })

  test('does not build active cockpit actions from resolved historical alerts', () => {
    const store = createSentinelAlertStore()
    const active = alert({
      dedupeKey: 'workspace-1:R2:dispatch-1',
      tier: 'critical',
      title: 'Dispatch overdue',
    })

    store.replaceWorkspaceAlerts('workspace-1', [active])
    expect(buildSentinelAlertActions(store.listWorkspaceAlerts('workspace-1'))).toHaveLength(1)

    store.replaceWorkspaceAlerts('workspace-1', [])

    expect(store.listWorkspaceAlerts('workspace-1')).toEqual([])
    expect(buildSentinelAlertActions(store.listWorkspaceAlerts('workspace-1'))).toEqual([])
  })
})
