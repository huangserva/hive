import { describe, expect, test } from 'vitest'
import type { DispatchRecord } from '../../src/server/dispatch-ledger-store.js'
import { evaluateSentinelRules } from '../../src/server/sentinel-rules.js'
import type { TeamListItem } from '../../src/shared/types.js'

const now = 1_800_000_000_000

const worker = (
  input: Partial<TeamListItem> & Pick<TeamListItem, 'id' | 'name'>
): TeamListItem => ({
  id: input.id,
  name: input.name,
  pendingTaskCount: input.pendingTaskCount ?? 0,
  role: input.role ?? 'coder',
  status: input.status ?? 'idle',
})

const dispatch = (
  input: Partial<DispatchRecord> & Pick<DispatchRecord, 'id' | 'toAgentId'>
): DispatchRecord => ({
  acceptVerdict: null,
  artifacts: [],
  createdAt: input.createdAt ?? now - 60_000,
  deliveredAt: input.deliveredAt ?? null,
  fromAgentId: input.fromAgentId ?? null,
  id: input.id,
  reportedAt: input.reportedAt ?? null,
  reportText: input.reportText ?? null,
  reviewStatus: input.reviewStatus ?? null,
  reviewsDispatchId: input.reviewsDispatchId ?? null,
  sequence: input.sequence ?? 1,
  status: input.status ?? 'submitted',
  submittedAt: input.submittedAt ?? now - 60_000,
  text: input.text ?? 'task',
  toAgentId: input.toAgentId,
  workspaceId: input.workspaceId ?? 'workspace-1',
})

describe('evaluateSentinelRules', () => {
  test('R1 warns on a persisted spawn failure and escalates repeated failures for the same worker', () => {
    const alerts = evaluateSentinelRules({
      dispatches: [],
      now,
      spawnFailures: [
        {
          command: 'codex',
          createdAt: now - 90_000,
          error: 'codex: command not found',
          path: '/usr/bin:/bin',
          workerId: 'worker-1',
          workerName: 'Codex',
          workspaceId: 'workspace-1',
        },
        {
          command: 'codex',
          createdAt: now - 30_000,
          error: 'codex: command not found',
          path: '/usr/bin:/bin',
          workerId: 'worker-1',
          workerName: 'Codex',
          workspaceId: 'workspace-1',
        },
      ],
      workers: [worker({ id: 'worker-1', name: 'Codex' })],
    })

    expect(alerts).toEqual([
      expect.objectContaining({
        dedupeKey: 'workspace-1:R1:worker-1:spawn_failed',
        ruleId: 'R1',
        tier: 'critical',
      }),
    ])
    expect(alerts[0]?.detail).toContain('command=codex')
    expect(alerts[0]?.detail).toContain('PATH=/usr/bin:/bin')
  })

  test('R2 marks report_overdue as warn, then critical after 10 minutes', () => {
    const alerts = evaluateSentinelRules({
      dispatches: [
        dispatch({
          id: 'dispatch-overdue',
          status: 'report_overdue',
          submittedAt: now - 11 * 60_000,
          toAgentId: 'worker-1',
        }),
      ],
      now,
      spawnFailures: [],
      workers: [worker({ id: 'worker-1', name: 'Coder', status: 'working' })],
    })

    expect(alerts).toEqual([
      expect.objectContaining({
        dedupeKey: 'workspace-1:R2:dispatch-overdue',
        ruleId: 'R2',
        tier: 'critical',
      }),
    ])
    expect(alerts[0]?.suggestedAction).toContain('team recover')
  })

  test('R4 reports stopped workers with open dispatches at warn and critical thresholds', () => {
    const alerts = evaluateSentinelRules({
      dispatches: [
        dispatch({
          id: 'dispatch-orphan-warn',
          submittedAt: now - 16 * 60_000,
          toAgentId: 'worker-1',
        }),
        dispatch({
          id: 'dispatch-orphan-critical',
          submittedAt: now - 31 * 60_000,
          toAgentId: 'worker-1',
        }),
      ],
      now,
      spawnFailures: [],
      workers: [worker({ id: 'worker-1', name: 'Coder', status: 'stopped' })],
    })

    expect(alerts.map((alert) => [alert.ruleId, alert.dedupeKey, alert.tier])).toEqual([
      ['R4', 'workspace-1:R4:dispatch-orphan-critical', 'critical'],
      ['R4', 'workspace-1:R4:dispatch-orphan-warn', 'warn'],
    ])
  })
})
