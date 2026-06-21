import { describe, expect, test } from 'vitest'

import {
  type CompactProgressSnapshot,
  createCompactRecoveryWatchdog,
  DEFAULT_COMPACT_HARD_RECOVERY_MS,
  DEFAULT_COMPACT_SOFT_PROBE_GRACE_MS,
} from '../../src/server/compact-recovery-watchdog.js'
import type { DispatchRecord } from '../../src/server/dispatch-ledger-store.js'

const WS = 'workspace-1'
const AGENT = 'worker-1'

const makeDispatch = (overrides: Partial<DispatchRecord> = {}): DispatchRecord => ({
  acceptVerdict: null,
  artifacts: [],
  createdAt: 1_000,
  deliveredAt: null,
  fromAgentId: 'orch',
  id: 'dispatch-1',
  reportedAt: null,
  reportText: null,
  reviewStatus: null,
  reviewsDispatchId: null,
  sequence: 1,
  status: 'submitted',
  submittedAt: 1_000,
  text: '实现一个需要恢复的派单',
  toAgentId: AGENT,
  workspaceId: WS,
  ...overrides,
})

const makeSnapshot = (fingerprint: string): CompactProgressSnapshot => ({
  fingerprint,
  gitFingerprint: fingerprint,
  maxWorkspaceMtimeMs: 1_000,
  ptyFingerprint: fingerprint,
  workflowJournalMtimeMs: null,
})

const makeHarness = () => {
  let now = 1_000
  let activeRun: { runId: string } | undefined = { runId: 'run-old' }
  const stopRequestedRunIds = new Set<string>()
  const dispatch = makeDispatch()
  let snapshot = makeSnapshot('same')
  const softProbes: Array<{ input: string; runId: string }> = []
  const stoppedRuns: string[] = []
  const started: Array<{ agentId: string; workspaceId: string }> = []
  const replayed: Array<{ dispatchId: string; input: string; runId: string }> = []
  const notices: Array<{ dispatchId: string; escalated: boolean; minutesAgo: number }> = []

  const watchdog = createCompactRecoveryWatchdog({
    autoRecoverEnabled: true,
    getActiveRunByAgentId: () => activeRun,
    getProgressSnapshot: () => snapshot,
    getRunStatusByRunId: (runId) =>
      runId === 'run-old' && stopRequestedRunIds.has(runId) ? 'exited' : 'running',
    hardRecoveryMs: DEFAULT_COMPACT_HARD_RECOVERY_MS,
    listOpenDispatchesForWorkspace: () => [dispatch],
    listWorkspaces: () => [{ id: WS, name: 'Workspace', path: '/tmp/workspace' }],
    now: () => now,
    notifyUserOfStaleDispatch: (_workspaceId, record, notice) =>
      notices.push({ dispatchId: record.id, ...notice }),
    softProbeGraceMs: DEFAULT_COMPACT_SOFT_PROBE_GRACE_MS,
    startAgent: async (workspaceId, agentId) => {
      started.push({ agentId, workspaceId })
      activeRun = { runId: 'run-new' }
      return { runId: 'run-new' }
    },
    stopAgentRun: (runId) => {
      stoppedRuns.push(runId)
      stopRequestedRunIds.add(runId)
      activeRun = undefined
    },
    writeRunInput: (runId, input) => {
      if (input.includes('compact recovery replay')) {
        replayed.push({ dispatchId: dispatch.id, input, runId })
      } else {
        softProbes.push({ input, runId })
      }
    },
  })

  return {
    dispatch,
    get activeRun() {
      return activeRun
    },
    notices,
    replayed,
    setActiveRun(run: { runId: string } | undefined) {
      activeRun = run
    },
    setNow(value: number) {
      now = value
    },
    setSnapshot(value: CompactProgressSnapshot) {
      snapshot = value
    },
    softProbes,
    started,
    stoppedRuns,
    watchdog,
  }
}

describe('compact recovery watchdog', () => {
  test('defaults to escalation only without stopping or restarting a silent worker', async () => {
    const dispatch = makeDispatch()
    const calls: string[] = []
    const notices: Array<{ escalated: boolean; reason?: string }> = []
    const watchdog = createCompactRecoveryWatchdog({
      getActiveRunByAgentId: () => ({ runId: 'run-old' }),
      getProgressSnapshot: () => makeSnapshot('same'),
      listOpenDispatchesForWorkspace: () => [dispatch],
      listWorkspaces: () => [{ id: WS, name: 'Workspace', path: '/tmp/workspace' }],
      markDispatchReportOverdue: (dispatchId) => {
        calls.push(`overdue:${dispatchId}`)
        return dispatch
      },
      now: () => 1_000 + DEFAULT_COMPACT_HARD_RECOVERY_MS,
      notifyUserOfStaleDispatch: (_workspaceId, _record, notice) => notices.push(notice),
      startAgent: async () => {
        calls.push('start')
        return { runId: 'unexpected' }
      },
      stopAgentRun: () => {
        calls.push('stop')
      },
      writeRunInput: () => {
        calls.push('write')
      },
    })

    await watchdog.tick()

    expect(calls).toEqual([`overdue:${dispatch.id}`])
    expect(notices).toEqual([expect.objectContaining({ escalated: true, reason: 'no_progress' })])
  })

  test('soft probes once before hard stop/restart/replay', async () => {
    const h = makeHarness()

    await h.watchdog.tick()
    h.setNow(1_000 + DEFAULT_COMPACT_HARD_RECOVERY_MS)
    await h.watchdog.tick()

    expect(h.softProbes).toHaveLength(1)
    expect(h.softProbes[0]?.runId).toBe('run-old')
    expect(h.stoppedRuns).toHaveLength(0)

    h.setNow(1_000 + DEFAULT_COMPACT_HARD_RECOVERY_MS + DEFAULT_COMPACT_SOFT_PROBE_GRACE_MS)
    await h.watchdog.tick()

    expect(h.stoppedRuns).toEqual(['run-old'])
    expect(h.started).toEqual([{ agentId: AGENT, workspaceId: WS }])
    expect(h.replayed).toHaveLength(1)
    expect(h.replayed[0]?.runId).toBe('run-new')
    expect(h.replayed[0]?.input).toContain(h.dispatch.id)
    expect(h.replayed[0]?.input).toContain(h.dispatch.text)
  })

  test('does not restart or replay if the original run cannot be confirmed stopped', async () => {
    let activeRun: { runId: string } | undefined = { runId: 'run-old' }
    const dispatch = makeDispatch()
    const notices: Array<{ escalated: boolean }> = []
    const overdueDispatchIds: string[] = []
    let clock = 1_000 + DEFAULT_COMPACT_HARD_RECOVERY_MS
    const watchdog = createCompactRecoveryWatchdog({
      autoRecoverEnabled: true,
      getActiveRunByAgentId: () => activeRun,
      getProgressSnapshot: () => makeSnapshot('same'),
      getRunStatusByRunId: () => 'running',
      listOpenDispatchesForWorkspace: () => [dispatch],
      listWorkspaces: () => [{ id: WS, name: 'Workspace', path: '/tmp/workspace' }],
      markDispatchReportOverdue: (dispatchId) => {
        overdueDispatchIds.push(dispatchId)
        return dispatch
      },
      now: () => clock,
      notifyUserOfStaleDispatch: (_workspaceId, _record, notice) => notices.push(notice),
      startAgent: async () => {
        throw new Error('must not restart while old run is active')
      },
      stopAgentRun: () => {
        // Mirrors stopRequested behavior: worker disappears from active lookup
        // before the PTY has actually exited.
        activeRun = undefined
      },
      writeRunInput: () => {},
    })

    await watchdog.tick()
    clock += DEFAULT_COMPACT_SOFT_PROBE_GRACE_MS
    await watchdog.tick()

    expect(notices).toEqual([expect.objectContaining({ escalated: true })])
    expect(overdueDispatchIds).toEqual([dispatch.id])
  })

  test('progress fingerprint changes extend the hard recovery window', async () => {
    const h = makeHarness()

    await h.watchdog.tick()
    h.setNow(1_000 + DEFAULT_COMPACT_HARD_RECOVERY_MS - 1)
    h.setSnapshot(makeSnapshot('new-git-diff'))
    await h.watchdog.tick()
    h.setNow(1_000 + DEFAULT_COMPACT_HARD_RECOVERY_MS + DEFAULT_COMPACT_SOFT_PROBE_GRACE_MS)
    await h.watchdog.tick()

    expect(h.softProbes).toHaveLength(0)
    expect(h.stoppedRuns).toHaveLength(0)
    expect(h.started).toHaveLength(0)
  })

  test('never auto-recovers queued dispatches or stopped workers', async () => {
    const dispatch = makeDispatch({ status: 'queued', submittedAt: null })
    const calls: string[] = []
    const stoppedWatchdog = createCompactRecoveryWatchdog({
      getActiveRunByAgentId: () => undefined,
      getProgressSnapshot: () => makeSnapshot('same'),
      listOpenDispatchesForWorkspace: () => [dispatch],
      listWorkspaces: () => [{ id: WS, name: 'Workspace', path: '/tmp/workspace' }],
      now: () => 1_000 + DEFAULT_COMPACT_HARD_RECOVERY_MS * 2,
      startAgent: async () => {
        calls.push('start')
        return { runId: 'unexpected' }
      },
      stopAgentRun: () => {
        calls.push('stop')
      },
      writeRunInput: () => {
        calls.push('write')
      },
    })

    await stoppedWatchdog.tick()

    expect(calls).toEqual([])
  })
})
