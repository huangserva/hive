import { describe, expect, test, vi } from 'vitest'
import type { DispatchRecord } from '../../src/server/dispatch-ledger-store.js'
import {
  buildOrphanedDispatchNudgeMessage,
  notifyOrphanedDispatchesOnWorkerExit,
} from '../../src/server/orphaned-dispatch-nudge.js'
import type { AgentSummary } from '../../src/shared/types.js'

const worker: AgentSummary = {
  description: 'Coder',
  id: 'worker-1',
  name: '关羽',
  pendingTaskCount: 1,
  role: 'coder',
  status: 'stopped',
  workspaceId: 'workspace-1',
}

const dispatch = (input: Partial<DispatchRecord> = {}): DispatchRecord => ({
  artifacts: [],
  createdAt: 1_700_000_000_000,
  deliveredAt: null,
  fromAgentId: 'workspace-1:orchestrator',
  id: 'dispatch-1',
  reportedAt: null,
  reportText: null,
  sequence: 1,
  status: 'submitted',
  submittedAt: 1_700_000_001_000,
  text: 'Implement feature',
  toAgentId: worker.id,
  workspaceId: worker.workspaceId,
  ...input,
})

describe('orphaned dispatch nudge on worker exit', () => {
  test('builds an orchestrator message listing open dispatches for the stopped worker', () => {
    const message = buildOrphanedDispatchNudgeMessage(worker, [
      dispatch({ id: 'dispatch-1', status: 'queued', submittedAt: null }),
      dispatch({ id: 'dispatch-2', status: 'submitted', submittedAt: 1_700_000_001_000 }),
    ])

    expect(message).toContain('[Hive 系统消息：worker 退出但有未完成 dispatch]')
    expect(message).toContain('Worker 关羽 已停止')
    expect(message).toContain('dispatch_id=dispatch-1, status=queued, submitted_at=none')
    expect(message).toContain('dispatch_id=dispatch-2, status=submitted')
    expect(message).toContain('请检查工作是否已完成')
  })

  test('injects an orphan nudge when a worker exits with open dispatches', () => {
    const inject = vi.fn()

    notifyOrphanedDispatchesOnWorkerExit({
      injectNudge: inject,
      listOpenDispatchesForWorker: () => [dispatch()],
      worker,
      workspaceId: worker.workspaceId,
    })

    expect(inject).toHaveBeenCalledWith(
      worker.workspaceId,
      expect.stringContaining('worker 退出但有未完成 dispatch')
    )
  })

  test('does not inject when the worker has no open dispatches', () => {
    const inject = vi.fn()

    notifyOrphanedDispatchesOnWorkerExit({
      injectNudge: inject,
      listOpenDispatchesForWorker: () => [],
      worker,
      workspaceId: worker.workspaceId,
    })

    expect(inject).not.toHaveBeenCalled()
  })
})
