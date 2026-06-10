import { describe, expect, test } from 'vitest'

import type { DispatchRecord, DispatchStatus } from '../../src/server/dispatch-ledger-store.js'
import { summarizeStaleDispatches } from '../../src/server/stale-dispatch-status.js'

const NOW = 10_000_000
const THRESHOLDS = { escalatedMs: 8 * 60 * 1000, staleMs: 4 * 60 * 1000 }

const dispatch = (status: DispatchStatus, id = status): DispatchRecord => ({
  artifacts: [],
  createdAt: NOW - 60 * 60 * 1000,
  deliveredAt: null,
  fromAgentId: null,
  id,
  reportedAt: null,
  reportText: null,
  sequence: 1,
  status,
  submittedAt: status === 'queued' ? null : NOW - 5 * 60 * 1000,
  text: `task ${id}`,
  toAgentId: 'worker-1',
  workspaceId: 'workspace-1',
})

describe('stale dispatch status semantics', () => {
  test('queued and terminal dispatches are not stale', () => {
    const summary = summarizeStaleDispatches(
      [
        dispatch('queued'),
        dispatch('completed'),
        dispatch('reported'),
        dispatch('cancelled'),
        dispatch('orphaned'),
      ],
      NOW,
      THRESHOLDS
    )

    expect(summary.stale).toEqual([])
    expect(summary.staleCount).toBe(0)
  })

  test('running and report_overdue dispatches can become stale', () => {
    const summary = summarizeStaleDispatches(
      [dispatch('running'), dispatch('report_overdue')],
      NOW,
      THRESHOLDS
    )

    expect(summary.stale.map((entry) => entry.dispatchId).sort()).toEqual([
      'report_overdue',
      'running',
    ])
    expect(summary.staleCount).toBe(2)
  })
})
