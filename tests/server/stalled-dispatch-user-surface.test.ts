import { afterEach, describe, expect, test } from 'vitest'

import { createDispatchLedgerStore } from '../../src/server/dispatch-ledger-store.js'
import { openRuntimeDatabase } from '../../src/server/runtime-database.js'
import {
  createStalledDispatchNudge,
  type StaleDispatchUserNotice,
} from '../../src/server/stalled-dispatch-nudge.js'

// 这条机制按「派单注入后时长」兜底通知 user，不依赖 PTY / worker idle 检测，
// 所以用真实 ledger + 可控时钟即可完整覆盖，无需也不应 mock PTY（AGENTS.md §3）。
describe('stalled dispatch → user surface (never silent)', () => {
  const databases: Array<ReturnType<typeof openRuntimeDatabase>> = []
  afterEach(() => {
    for (const db of databases.splice(0)) db.close()
  })

  const setup = () => {
    const db = openRuntimeDatabase()
    databases.push(db)
    const ledger = createDispatchLedgerStore(db)
    const notices: Array<{ dispatchId: string } & StaleDispatchUserNotice> = []
    let clock = 0
    const nudge = createStalledDispatchNudge({
      escalatedMs: 3000,
      // surface pass 不读 active run；返回 undefined 同时也让 LLM 兜底 nudge 不触发，隔离被测路径。
      getActiveRunByAgentId: () => undefined,
      injectNudge: () => {},
      listOpenDispatchesForWorkspace: (workspaceId) =>
        ledger.listOpenDispatchesForWorkspace(workspaceId),
      listWorkspaces: () => [{ id: 'ws-1', name: 'ws-1', path: '/tmp/ws-1' }],
      notifyUserOfStaleDispatch: (_workspaceId, dispatch, notice) =>
        notices.push({ dispatchId: dispatch.id, ...notice }),
      now: () => clock,
      staleMs: 1000,
    })
    const submit = (text: string) => {
      const dispatch = ledger.createDispatch({ text, toAgentId: 'worker-1', workspaceId: 'ws-1' })
      ledger.markSubmitted(dispatch.id)
      const submittedAt = ledger
        .listOpenDispatchesForWorkspace('ws-1')
        .find((entry) => entry.id === dispatch.id)?.submittedAt
      if (submittedAt === null || submittedAt === undefined) throw new Error('no submittedAt')
      return { id: dispatch.id, submittedAt }
    }
    return { ledger, nudge, notices, setClock: (value: number) => (clock = value), submit }
  }

  test('a submitted dispatch surfaces to the user once it crosses the stale threshold', () => {
    const { nudge, notices, setClock, submit } = setup()
    const { id, submittedAt } = submit('finish the UX work and report')

    setClock(submittedAt + 500) // under stale threshold
    nudge.tick()
    expect(notices).toHaveLength(0)

    setClock(submittedAt + 1500) // past stale (1000), under escalated (3000)
    nudge.tick()
    expect(notices).toEqual([{ dispatchId: id, escalated: false, minutesAgo: 0 }])
  })

  test('escalates to a second user notice once it crosses the escalated threshold (K nudges ineffective)', () => {
    const { nudge, notices, setClock, submit } = setup()
    const { id, submittedAt } = submit('finish and report')

    setClock(submittedAt + 1500)
    nudge.tick()
    setClock(submittedAt + 4000) // past escalated (3000)
    nudge.tick()

    expect(notices).toEqual([
      { dispatchId: id, escalated: false, minutesAgo: 0 },
      { dispatchId: id, escalated: true, minutesAgo: 0 },
    ])
  })

  test('does not re-notify the same tier on repeated ticks (deduped per dispatch per tier)', () => {
    const { nudge, notices, setClock, submit } = setup()
    const { submittedAt } = submit('finish and report')

    setClock(submittedAt + 5000) // already past both thresholds
    nudge.tick()
    nudge.tick()
    nudge.tick()

    expect(notices.filter((n) => !n.escalated)).toHaveLength(1)
    expect(notices.filter((n) => n.escalated)).toHaveLength(1)
  })

  test('a queued (never-injected) dispatch is not surfaced as unreported', () => {
    const { ledger, nudge, notices, setClock } = setup()
    ledger.createDispatch({ text: 'queued only', toAgentId: 'worker-1', workspaceId: 'ws-1' })

    setClock(1_000_000)
    nudge.tick()

    expect(notices).toHaveLength(0)
  })

  test('once the worker reports, the dispatch stops surfacing', () => {
    const { ledger, nudge, notices, setClock, submit } = setup()
    const { id, submittedAt } = submit('finish and report')

    setClock(submittedAt + 1500)
    nudge.tick()
    expect(notices).toHaveLength(1)

    ledger.markReportedByWorker({
      artifacts: [],
      dispatchId: id,
      reportText: 'done',
      toAgentId: 'worker-1',
      workspaceId: 'ws-1',
    })
    setClock(submittedAt + 9000)
    nudge.tick()
    // No escalated notice — a reported dispatch is no longer open/submitted.
    expect(notices.filter((n) => n.escalated)).toHaveLength(0)
  })
})
