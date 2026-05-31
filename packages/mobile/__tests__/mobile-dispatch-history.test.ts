import { describe, expect, test } from 'vitest'

import { getRelevantDispatchHistory } from '../src/api/mobile-dispatch-history'

describe('mobile dispatch history filtering', () => {
  test('matches dispatch history by worker id and keeps legacy name fallback', () => {
    const worker = { id: 'worker-1', name: 'Alice' }
    const dispatches = [
      {
        created_at: '2026-05-31T08:00:00.000Z',
        id: 'd-1',
        status: 'pending' as const,
        task_summary: 'Current task',
        worker_id: 'worker-1',
        worker_name: 'Alice',
      },
      {
        created_at: '2026-05-31T08:01:00.000Z',
        id: 'd-2',
        status: 'done' as const,
        task_summary: 'Legacy task',
        worker_name: 'Alice',
      },
      {
        created_at: '2026-05-31T08:02:00.000Z',
        id: 'd-3',
        status: 'done' as const,
        task_summary: 'Other worker',
        worker_id: 'worker-2',
        worker_name: 'Bob',
      },
    ]

    expect(
      getRelevantDispatchHistory(dispatches, worker, false).map((dispatch) => dispatch.id)
    ).toEqual(['d-1', 'd-2'])
  })

  test('returns empty history for orchestrator or missing worker', () => {
    expect(getRelevantDispatchHistory([], null, false)).toEqual([])
    expect(getRelevantDispatchHistory([], { id: 'worker-1', name: 'Alice' }, true)).toEqual([])
  })
})
