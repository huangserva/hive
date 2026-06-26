import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { createDispatchLedgerStore } from '../../src/server/dispatch-ledger-store.js'
import { openRuntimeDatabase } from '../../src/server/runtime-database.js'
import { createStalledDispatchNudge } from '../../src/server/stalled-dispatch-nudge.js'

const WS = 'ws-1'
const STALE_MS = 1000

describe('stalled dispatch nudge (Fix B)', () => {
  let db: ReturnType<typeof openRuntimeDatabase>
  let ledger: ReturnType<typeof createDispatchLedgerStore>
  // 控制哪些 worker「alive」（有 active run）。真实状态机用真 sqlite，alive 是注入的边界。
  let aliveWorkers: Set<string>
  let nudges: Array<{ message: string; workspaceId: string }>
  let workerNudges: Array<{ agentId: string; message: string; workspaceId: string }>
  let workerOutput: Map<string, string>
  let clock: number

  const seedSubmitted = (toAgentId: string) => {
    const dispatch = ledger.createDispatch({
      text: `task for ${toAgentId}`,
      toAgentId,
      workspaceId: WS,
    })
    ledger.markSubmitted(dispatch.id)
    const submitted = ledger
      .listOpenDispatchesForWorkspace(WS)
      .find((record) => record.id === dispatch.id)
    if (!submitted || submitted.submittedAt === null) {
      throw new Error('seed failed: dispatch not submitted')
    }
    return { ...submitted, submittedAt: submitted.submittedAt }
  }

  const setSubmittedAt = (dispatchId: string, submittedAt: number) => {
    db.prepare('UPDATE dispatches SET submitted_at = ? WHERE id = ?').run(submittedAt, dispatchId)
    const submitted = ledger
      .listOpenDispatchesForWorkspace(WS)
      .find((record) => record.id === dispatchId)
    if (!submitted || submitted.submittedAt === null) {
      throw new Error('setSubmittedAt failed')
    }
    return { ...submitted, submittedAt: submitted.submittedAt }
  }

  const makeNudge = () =>
    createStalledDispatchNudge({
      getActiveRunByAgentId: (_workspaceId, agentId) =>
        aliveWorkers.has(agentId) ? { runId: `run-${agentId}` } : undefined,
      injectNudge: (workspaceId, message) => nudges.push({ message, workspaceId }),
      listOpenDispatchesForWorkspace: (workspaceId) =>
        ledger.listOpenDispatchesForWorkspace(workspaceId),
      listWorkspaces: () => [{ id: WS, name: WS, path: `/tmp/${WS}` }],
      markDispatchReportOverdue: (dispatchId) => ledger.markReportOverdue(dispatchId),
      now: () => clock,
      staleMs: STALE_MS,
    })

  const makeDeliveryNudge = () =>
    createStalledDispatchNudge({
      deliveryAckStaleMs: 90_000,
      getActiveRunByAgentId: (_workspaceId, agentId) =>
        aliveWorkers.has(agentId) ? { runId: `run-${agentId}` } : undefined,
      injectNudge: (workspaceId, message) => nudges.push({ message, workspaceId }),
      listOpenDispatchesForWorkspace: (workspaceId) =>
        ledger.listOpenDispatchesForWorkspace(workspaceId),
      listWorkspaces: () => [{ id: WS, name: WS, path: `/tmp/${WS}` }],
      markDispatchReportOverdue: (dispatchId) => ledger.markReportOverdue(dispatchId),
      now: () => clock,
      staleMs: 4 * 60_000,
      startupAt: 0,
    })

  const makeIdleNudge = () =>
    createStalledDispatchNudge({
      getActiveRunByAgentId: (_workspaceId, agentId) =>
        aliveWorkers.has(agentId) ? { runId: `run-${agentId}` } : undefined,
      getWorkerOutputSinceActivity: (_workspaceId: string, agentId: string) =>
        workerOutput.get(agentId) ?? '',
      injectNudge: (workspaceId, message) => nudges.push({ message, workspaceId }),
      injectWorkerNudge: (workspaceId: string, agentId: string, message: string) =>
        workerNudges.push({ agentId, message, workspaceId }),
      idleGraceMs: 20_000,
      listOpenDispatchesForWorkspace: (workspaceId) =>
        ledger.listOpenDispatchesForWorkspace(workspaceId),
      listWorkspaces: () => [{ id: WS, name: WS, path: `/tmp/${WS}` }],
      markDispatchReportOverdue: (dispatchId) => ledger.markReportOverdue(dispatchId),
      now: () => clock,
      staleMs: STALE_MS,
      startupAt: 0,
    })

  beforeEach(() => {
    db = openRuntimeDatabase()
    ledger = createDispatchLedgerStore(db)
    aliveWorkers = new Set()
    nudges = []
    workerNudges = []
    workerOutput = new Map()
  })

  afterEach(() => {
    db.close()
  })

  test('nudges for an active dispatch past the threshold whose worker is still alive', () => {
    const dispatch = seedSubmitted('worker-1')
    aliveWorkers.add('worker-1')
    clock = dispatch.submittedAt + STALE_MS // exactly at threshold counts as stale

    makeNudge().tick()

    expect(nudges).toHaveLength(1)
    expect(nudges[0]?.workspaceId).toBe(WS)
    expect(nudges[0]?.message).toContain(dispatch.id)
    // adversarial: a passing nudge must actually name the stalled dispatch, not be a generic ping.
    expect(nudges[0]?.message).toContain('active/report_overdue')
    expect(ledger.findOpenDispatch(WS, 'worker-1', dispatch.id)?.status).toBe('report_overdue')
  })

  test('does not nudge before the staleness threshold elapses', () => {
    const dispatch = seedSubmitted('worker-1')
    aliveWorkers.add('worker-1')
    clock = dispatch.submittedAt + STALE_MS - 1

    makeNudge().tick()

    expect(nudges).toHaveLength(0)
  })

  test('quickly nudges orchestrator when submitted input was never acknowledged', () => {
    const dispatch = seedSubmitted('worker-1')
    aliveWorkers.add('worker-1')
    clock = dispatch.submittedAt + 90_000

    makeDeliveryNudge().tick()

    expect(nudges).toHaveLength(1)
    expect(nudges[0]?.workspaceId).toBe(WS)
    expect(nudges[0]?.message).toContain(dispatch.id)
    expect(nudges[0]?.message).toContain('派单可能没送达')
    expect(nudges[0]?.message).toContain('不会自动重投')
    expect(ledger.findOpenDispatch(WS, 'worker-1', dispatch.id)?.status).toBe('report_overdue')
  })

  test('does not delivery-nudge a submitted dispatch after input acknowledgement lands', () => {
    const dispatch = seedSubmitted('worker-1')
    ledger.markInputAcknowledged(dispatch.id)
    aliveWorkers.add('worker-1')
    clock = dispatch.submittedAt + 90_000

    makeDeliveryNudge().tick()

    expect(nudges).toHaveLength(0)
    expect(ledger.findOpenDispatch(WS, 'worker-1', dispatch.id)?.status).toBe('running')
  })

  test('nudges immediately when input delivery was explicitly marked failed', () => {
    const dispatch = seedSubmitted('worker-1')
    ledger.markInputDeliveryFailed(dispatch.id)
    aliveWorkers.add('worker-1')
    clock = dispatch.submittedAt + 1000

    makeDeliveryNudge().tick()

    expect(nudges).toHaveLength(1)
    expect(nudges[0]?.message).toContain(dispatch.id)
    expect(nudges[0]?.message).toContain('input_delivery_failed')
  })

  test('does not delivery-nudge legacy in-flight dispatches submitted before startup', () => {
    const startupAt = 1_000_000
    const dispatch = seedSubmitted('worker-1')
    const legacyDispatch = setSubmittedAt(dispatch.id, startupAt - 1)
    aliveWorkers.add('worker-1')
    clock = legacyDispatch.submittedAt + 5 * 60_000

    createStalledDispatchNudge({
      deliveryAckStaleMs: 90_000,
      getActiveRunByAgentId: (_workspaceId, agentId) =>
        aliveWorkers.has(agentId) ? { runId: `run-${agentId}` } : undefined,
      injectNudge: (workspaceId, message) => nudges.push({ message, workspaceId }),
      listOpenDispatchesForWorkspace: (workspaceId) =>
        ledger.listOpenDispatchesForWorkspace(workspaceId),
      listWorkspaces: () => [{ id: WS, name: WS, path: `/tmp/${WS}` }],
      markDispatchReportOverdue: (dispatchId) => ledger.markReportOverdue(dispatchId),
      now: () => clock,
      staleMs: 10 * 60_000,
      startupAt,
    }).tick()

    expect(nudges).toHaveLength(0)
    expect(ledger.findOpenDispatch(WS, 'worker-1', dispatch.id)?.status).toBe('running')
  })

  test('does not send a second orchestrator nudge after delivery nudge reaches stale threshold', () => {
    const dispatch = seedSubmitted('worker-1')
    aliveWorkers.add('worker-1')
    clock = dispatch.submittedAt + 90_000
    const nudge = makeDeliveryNudge()

    nudge.tick()
    expect(nudges).toHaveLength(1)
    expect(nudges[0]?.message).toContain('派单投递未确认')

    clock = dispatch.submittedAt + 4 * 60_000 + 1
    nudge.tick()

    expect(nudges).toHaveLength(1)
  })

  test('does not send idle-self-heal fallback orchestrator nudge after delivery nudge', () => {
    const dispatch = seedSubmitted('worker-1')
    aliveWorkers.add('worker-1')
    workerOutput.set('worker-1', 'ready\n❯ ')
    clock = dispatch.submittedAt + 90_000
    const nudge = makeIdleNudge()

    nudge.tick()
    expect(nudges).toHaveLength(1)
    expect(workerNudges).toHaveLength(0)

    clock += 20_000
    nudge.tick()
    clock += 20_000
    nudge.tick()
    clock += 20_000
    nudge.tick()

    expect(workerNudges).toHaveLength(2)
    expect(nudges).toHaveLength(1)
  })

  test('does not nudge when the worker is stopped (no active run) — left to reconcile', () => {
    const dispatch = seedSubmitted('worker-1')
    // worker-1 NOT added to aliveWorkers → getActiveRunByAgentId returns undefined (stopped).
    clock = dispatch.submittedAt + STALE_MS + 60_000

    makeNudge().tick()

    expect(nudges).toHaveLength(0)
  })

  test('does not nudge reported or cancelled dispatches', () => {
    const reported = seedSubmitted('worker-1')
    const cancelled = seedSubmitted('worker-2')
    aliveWorkers.add('worker-1')
    aliveWorkers.add('worker-2')
    ledger.markReportedByWorker({
      artifacts: [],
      dispatchId: reported.id,
      reportText: 'done',
      toAgentId: 'worker-1',
      workspaceId: WS,
    })
    ledger.markCancelled({ dispatchId: cancelled.id, reason: 'abort', workspaceId: WS })
    clock = reported.submittedAt + STALE_MS + 60_000

    makeNudge().tick()

    expect(nudges).toHaveLength(0)
  })

  test('does not nudge a queued (not yet submitted) dispatch', () => {
    const dispatch = ledger.createDispatch({
      text: 'queued only',
      toAgentId: 'worker-1',
      workspaceId: WS,
    })
    expect(dispatch.status).toBe('queued')
    aliveWorkers.add('worker-1')
    clock = dispatch.createdAt + STALE_MS + 60_000

    makeNudge().tick()

    expect(nudges).toHaveLength(0)
  })

  test('nudges a given stalled dispatch only once across repeated ticks', () => {
    const dispatch = seedSubmitted('worker-1')
    aliveWorkers.add('worker-1')
    clock = dispatch.submittedAt + STALE_MS + 1
    const nudge = makeNudge()

    nudge.tick()
    expect(nudges).toHaveLength(1)

    // Still active, still alive, even more time passed → must NOT nudge again.
    clock += 5 * 60_000
    nudge.tick()
    expect(nudges).toHaveLength(1)
  })

  test('directly reminds an idle worker with an active dispatch after the prompt stays ready for the grace window', () => {
    const dispatch = seedSubmitted('worker-1')
    aliveWorkers.add('worker-1')
    workerOutput.set('worker-1', 'finished work\n❯ ')
    clock = dispatch.submittedAt
    const nudge = makeIdleNudge()

    nudge.tick()
    expect(workerNudges).toHaveLength(0)

    clock += 20_000
    nudge.tick()

    expect(workerNudges).toEqual([
      expect.objectContaining({
        agentId: 'worker-1',
        workspaceId: WS,
      }),
    ])
    expect(workerNudges[0]?.message).toContain(dispatch.id)
    expect(workerNudges[0]?.message).toContain('team report')
    expect(workerNudges[0]?.message).toContain('写文字总结不算汇报')
    expect(ledger.findOpenDispatch(WS, 'worker-1', dispatch.id)?.status).toBe('report_overdue')
    expect(nudges).toHaveLength(0)
  })

  test('does not remind a worker that is still producing non-prompt output', () => {
    const dispatch = seedSubmitted('worker-1')
    aliveWorkers.add('worker-1')
    workerOutput.set('worker-1', 'running tests\nstill working\n')
    clock = dispatch.submittedAt
    const nudge = makeIdleNudge()

    nudge.tick()
    clock += 60_000
    nudge.tick()

    expect(workerNudges).toHaveLength(0)
    expect(nudges).toHaveLength(0)
  })

  test('falls back to the orchestrator nudge after two direct idle reminders for the same dispatch', () => {
    const dispatch = seedSubmitted('worker-1')
    aliveWorkers.add('worker-1')
    workerOutput.set('worker-1', 'ready\n❯ ')
    clock = dispatch.submittedAt
    const nudge = makeIdleNudge()

    nudge.tick()
    clock += 20_000
    nudge.tick()
    clock += 20_000
    nudge.tick()
    clock += 20_000
    nudge.tick()

    expect(workerNudges).toHaveLength(2)
    expect(workerNudges.every((entry) => entry.message.includes(dispatch.id))).toBe(true)
    expect(nudges).toHaveLength(1)
    expect(nudges[0]?.message).toContain(dispatch.id)
  })

  test('stops direct reminders once the worker reports the dispatch', () => {
    const dispatch = seedSubmitted('worker-1')
    aliveWorkers.add('worker-1')
    workerOutput.set('worker-1', 'ready\n❯ ')
    clock = dispatch.submittedAt
    const nudge = makeIdleNudge()

    nudge.tick()
    clock += 20_000
    nudge.tick()
    ledger.markReportedByWorker({
      artifacts: [],
      dispatchId: dispatch.id,
      reportText: 'reported after reminder',
      toAgentId: 'worker-1',
      workspaceId: WS,
    })
    clock += 20_000
    nudge.tick()

    expect(workerNudges).toHaveLength(1)
    expect(nudges).toHaveLength(0)
  })

  test('does not trigger on an old prompt when the new-output slice is empty', () => {
    const dispatch = seedSubmitted('worker-1')
    aliveWorkers.add('worker-1')
    workerOutput.set('worker-1', '')
    clock = dispatch.submittedAt
    const nudge = makeIdleNudge()

    nudge.tick()
    clock += 60_000
    nudge.tick()

    expect(workerNudges).toHaveLength(0)
    expect(nudges).toHaveLength(0)
  })

  test('uses active-run output baselines so prompts that predate the dispatch do not trigger reminders', () => {
    const dispatch = seedSubmitted('worker-1')
    aliveWorkers.add('worker-1')
    workerOutput.set('worker-1', 'old session prompt\n❯ ')
    clock = dispatch.submittedAt
    const writtenInputs: Array<{ input: string; runId: string }> = []
    const nudge = createStalledDispatchNudge({
      getActiveRunByAgentId: (_workspaceId, agentId) =>
        aliveWorkers.has(agentId)
          ? { output: workerOutput.get(agentId) ?? '', runId: `run-${agentId}` }
          : undefined,
      injectNudge: (workspaceId, message) => nudges.push({ message, workspaceId }),
      idleGraceMs: 20_000,
      listOpenDispatchesForWorkspace: (workspaceId) =>
        ledger.listOpenDispatchesForWorkspace(workspaceId),
      listWorkspaces: () => [{ id: WS, name: WS, path: `/tmp/${WS}` }],
      now: () => clock,
      staleMs: STALE_MS,
      writeRunInput: (runId, input) => writtenInputs.push({ input, runId }),
    })

    nudge.tick()
    clock += 60_000
    nudge.tick()
    expect(writtenInputs).toHaveLength(0)

    workerOutput.set('worker-1', 'old session prompt\n❯ \nactual task finished\n❯ ')
    nudge.tick()
    clock += 20_000
    nudge.tick()

    expect(writtenInputs).toHaveLength(1)
    expect(writtenInputs[0]?.runId).toBe('run-worker-1')
    expect(writtenInputs[0]?.input).toContain(dispatch.id)
    expect(writtenInputs[0]?.input).toContain('team report')
  })
})
