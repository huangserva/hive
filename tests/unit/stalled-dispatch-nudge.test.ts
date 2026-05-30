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

  const makeNudge = () =>
    createStalledDispatchNudge({
      getActiveRunByAgentId: (_workspaceId, agentId) =>
        aliveWorkers.has(agentId) ? { runId: `run-${agentId}` } : undefined,
      injectNudge: (workspaceId, message) => nudges.push({ message, workspaceId }),
      listOpenDispatchesForWorkspace: (workspaceId) =>
        ledger.listOpenDispatchesForWorkspace(workspaceId),
      listWorkspaces: () => [{ id: WS, name: WS, path: `/tmp/${WS}` }],
      now: () => clock,
      staleMs: STALE_MS,
    })

  beforeEach(() => {
    db = openRuntimeDatabase()
    ledger = createDispatchLedgerStore(db)
    aliveWorkers = new Set()
    nudges = []
  })

  afterEach(() => {
    db.close()
  })

  test('nudges for a submitted dispatch past the threshold whose worker is still alive', () => {
    const dispatch = seedSubmitted('worker-1')
    aliveWorkers.add('worker-1')
    clock = dispatch.submittedAt + STALE_MS // exactly at threshold counts as stale

    makeNudge().tick()

    expect(nudges).toHaveLength(1)
    expect(nudges[0]?.workspaceId).toBe(WS)
    expect(nudges[0]?.message).toContain(dispatch.id)
    // adversarial: a passing nudge must actually name the stalled dispatch, not be a generic ping.
    expect(nudges[0]?.message).toContain('submitted')
  })

  test('does not nudge before the staleness threshold elapses', () => {
    const dispatch = seedSubmitted('worker-1')
    aliveWorkers.add('worker-1')
    clock = dispatch.submittedAt + STALE_MS - 1

    makeNudge().tick()

    expect(nudges).toHaveLength(0)
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

    // Still submitted, still alive, even more time passed → must NOT nudge again.
    clock += 5 * 60_000
    nudge.tick()
    expect(nudges).toHaveLength(1)
  })
})
