import { describe, expect, test } from 'vitest'

import type { DispatchRecord, DispatchStatus } from '../../src/server/dispatch-ledger-store.js'
import { summarizeStaleDispatches } from '../../src/server/stale-dispatch-status.js'

const NOW = 10_000_000

const dispatch = (over: Partial<DispatchRecord> & { id: string; status: DispatchStatus }) =>
  ({
    artifacts: [],
    createdAt: 0,
    deliveredAt: null,
    fromAgentId: null,
    reportedAt: null,
    reportText: null,
    sequence: 1,
    submittedAt: null,
    text: 'do the thing',
    toAgentId: 'worker-1',
    workspaceId: 'ws-1',
    ...over,
  }) satisfies DispatchRecord

const THRESHOLDS = { escalatedMs: 8 * 60 * 1000, staleMs: 4 * 60 * 1000 }

describe('summarizeStaleDispatches', () => {
  test('counts a running dispatch unreported past the stale threshold', () => {
    const summary = summarizeStaleDispatches(
      [dispatch({ id: 'd1', status: 'running', submittedAt: NOW - 5 * 60 * 1000 })],
      NOW,
      THRESHOLDS
    )
    expect(summary.staleCount).toBe(1)
    expect(summary.escalatedCount).toBe(0)
    expect(summary.stale[0]).toMatchObject({ dispatchId: 'd1', escalated: false, minutesAgo: 5 })
  })

  test('a freshly running dispatch (under threshold) is NOT stale', () => {
    const summary = summarizeStaleDispatches(
      [dispatch({ id: 'd1', status: 'running', submittedAt: NOW - 60 * 1000 })],
      NOW,
      THRESHOLDS
    )
    expect(summary.staleCount).toBe(0)
    expect(summary.escalatedCount).toBe(0)
  })

  test('past the escalated threshold it is both stale and escalated', () => {
    const summary = summarizeStaleDispatches(
      [dispatch({ id: 'd1', status: 'submitted', submittedAt: NOW - 9 * 60 * 1000 })],
      NOW,
      THRESHOLDS
    )
    expect(summary.staleCount).toBe(1)
    expect(summary.escalatedCount).toBe(1)
    expect(summary.stale[0]?.escalated).toBe(true)
  })

  test('queued / reported / cancelled are never counted (only submitted = injected-unreported)', () => {
    const old = NOW - 60 * 60 * 1000
    const summary = summarizeStaleDispatches(
      [
        dispatch({ id: 'q', status: 'queued', submittedAt: null }),
        dispatch({ id: 'r', status: 'reported', submittedAt: old }),
        dispatch({ id: 'done', status: 'completed', submittedAt: old }),
        dispatch({ id: 'c', status: 'cancelled', submittedAt: old }),
        dispatch({ id: 'o', status: 'orphaned', submittedAt: old }),
      ],
      NOW,
      THRESHOLDS
    )
    expect(summary.staleCount).toBe(0)
    expect(summary.escalatedCount).toBe(0)
  })

  test('a submitted dispatch with null submittedAt is ignored (cannot age it)', () => {
    const summary = summarizeStaleDispatches(
      [dispatch({ id: 'd1', status: 'submitted', submittedAt: null })],
      NOW,
      THRESHOLDS
    )
    expect(summary.staleCount).toBe(0)
  })

  test('mixes: only the stale submitted ones are surfaced, escalated is a subset', () => {
    const summary = summarizeStaleDispatches(
      [
        dispatch({ id: 'fresh', status: 'running', submittedAt: NOW - 30 * 1000 }),
        dispatch({ id: 'stale', status: 'running', submittedAt: NOW - 5 * 60 * 1000 }),
        dispatch({ id: 'overdue', status: 'report_overdue', submittedAt: NOW - 6 * 60 * 1000 }),
        dispatch({ id: 'escal', status: 'submitted', submittedAt: NOW - 12 * 60 * 1000 }),
        dispatch({ id: 'done', status: 'completed', submittedAt: NOW - 20 * 60 * 1000 }),
      ],
      NOW,
      THRESHOLDS
    )
    expect(summary.staleCount).toBe(3)
    expect(summary.escalatedCount).toBe(1)
    expect(summary.stale.map((entry) => entry.dispatchId).sort()).toEqual([
      'escal',
      'overdue',
      'stale',
    ])
  })
})
