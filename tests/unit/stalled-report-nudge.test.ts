import { describe, expect, test } from 'vitest'

import type { DispatchRecord } from '../../src/server/dispatch-ledger-store.js'
import {
  buildUnacknowledgedReportNudgeMessage,
  createStalledReportNudge,
} from '../../src/server/stalled-report-nudge.js'

const dispatch = (overrides: Partial<DispatchRecord> = {}): DispatchRecord => ({
  acceptVerdict: null,
  artifacts: [],
  createdAt: 1_000,
  deliveredAt: 1_500,
  evidence: [],
  fromAgentId: 'workspace-1:orchestrator',
  id: 'dispatch-1',
  inputAcknowledgedAt: 2_000,
  inputDeliveryFailedAt: null,
  lateReportForwardedAt: null,
  reportAcknowledgedAt: null,
  reportDeliveryFailedAt: null,
  reportedAt: 10_000,
  reportText: 'Done',
  reviewStatus: null,
  reviewsDispatchId: null,
  sequence: 1,
  status: 'completed',
  submittedAt: 2_000,
  text: 'Task',
  toAgentId: 'worker-1',
  workspaceId: 'workspace-1',
  ...overrides,
})

describe('stalled report nudge', () => {
  test('surfaces completed reports whose orchestrator delivery explicitly failed', () => {
    const nudges: Array<{ message: string; workspaceId: string }> = []
    const nudge = createStalledReportNudge({
      injectNudge: (workspaceId, message) => nudges.push({ message, workspaceId }),
      listDispatchesForWorkspace: () => [
        dispatch({ id: 'failed-report', reportDeliveryFailedAt: 11_000 }),
      ],
      listWorkspaces: () => [{ id: 'workspace-1', name: 'Workspace', path: '/tmp/ws' }],
      now: () => 12_000,
      startupAt: 12_000,
    })

    nudge.tick()

    expect(nudges).toHaveLength(1)
    expect(nudges[0]?.workspaceId).toBe('workspace-1')
    expect(nudges[0]?.message).toContain('failed-report')
    expect(nudges[0]?.message).toContain('report_delivery_failed')
  })

  test('surfaces new completed reports that remain unacknowledged past the stale window', () => {
    const nudges: Array<{ message: string; workspaceId: string }> = []
    const nudge = createStalledReportNudge({
      injectNudge: (workspaceId, message) => nudges.push({ message, workspaceId }),
      listDispatchesForWorkspace: () => [dispatch({ id: 'timeout-report', reportedAt: 20_000 })],
      listWorkspaces: () => [{ id: 'workspace-1', name: 'Workspace', path: '/tmp/ws' }],
      now: () => 112_000,
      reportAckStaleMs: 90_000,
      startupAt: 19_000,
    })

    nudge.tick()

    expect(nudges).toHaveLength(1)
    expect(nudges[0]?.message).toContain('timeout-report')
    expect(nudges[0]?.message).toContain('report_ack_timeout')
  })

  test('does not surface acknowledged reports or old pre-start reports without explicit failure', () => {
    const nudges: string[] = []
    const nudge = createStalledReportNudge({
      injectNudge: (_workspaceId, message) => nudges.push(message),
      listDispatchesForWorkspace: () => [
        dispatch({ id: 'acked', reportAcknowledgedAt: 12_000 }),
        dispatch({ id: 'old', reportedAt: 5_000 }),
      ],
      listWorkspaces: () => [{ id: 'workspace-1', name: 'Workspace', path: '/tmp/ws' }],
      now: () => 500_000,
      startupAt: 10_000,
    })

    nudge.tick()

    expect(nudges).toEqual([])
  })

  test('nudge text names the delivery state instead of implying orchestrator saw the report', () => {
    const message = buildUnacknowledgedReportNudgeMessage([
      {
        dispatchId: 'dispatch-1',
        minutesAgo: 2,
        reason: 'report_ack_timeout',
        reportedAt: 10_000,
        workerId: 'worker-1',
      },
    ])

    expect(message).toContain('worker report 回灌未确认')
    expect(message).toContain('请不要假设 orch 已看到结果')
  })
})
