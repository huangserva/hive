import { describe, expect, test, vi } from 'vitest'

import { createSentinelHeartbeat } from '../../src/server/sentinel-heartbeat.js'

describe('sentinel heartbeat', () => {
  test('injects cockpit and git summaries only into active sentinel runs', async () => {
    const writeRunInput = vi.fn()
    const heartbeat = createSentinelHeartbeat({
      buildCockpitSnapshot: () => ({
        aiActions: [{ id: 'baseline-stale', priority: 'medium', text: 'Baseline stale' }],
        baselineStale: true,
        openQuestions: 1,
      }),
      getActiveRunByAgentId: (_workspaceId, agentId) =>
        agentId === 'workspace-1:sentinel' ? { runId: 'run-sentinel' } : undefined,
      getGitSummary: () => 'M src/server/example.ts',
      getWorkerConfig: () => ({}),
      listWorkers: () => [
        {
          id: 'workspace-1:sentinel',
          name: 'Sentinel',
          pendingTaskCount: 0,
          role: 'sentinel',
          status: 'idle',
        },
        {
          id: 'workspace-1:coder',
          name: 'Coder',
          pendingTaskCount: 0,
          role: 'coder',
          status: 'idle',
        },
      ],
      listWorkspaces: () => [{ id: 'workspace-1', name: 'Alpha', path: '/tmp/alpha' }],
      writeRunInput,
    })

    await heartbeat.tick()

    expect(writeRunInput).toHaveBeenCalledTimes(1)
    expect(writeRunInput).toHaveBeenCalledWith(
      'run-sentinel',
      expect.stringContaining('[Hive 系统消息：sentinel heartbeat]')
    )
    expect(writeRunInput.mock.calls[0]?.[1]).toContain('open_questions=1')
    expect(writeRunInput.mock.calls[0]?.[1]).toContain('M src/server/example.ts')
  })

  test('uses per-sentinel heartbeat interval from worker config', async () => {
    let now = 1_000
    const writeRunInput = vi.fn()
    const heartbeat = createSentinelHeartbeat({
      getActiveRunByAgentId: () => ({ runId: 'run-sentinel' }),
      getWorkerConfig: () => ({ heartbeat_interval_ms: 120_000 }),
      listWorkers: () => [
        {
          id: 'workspace-1:sentinel',
          name: 'Sentinel',
          pendingTaskCount: 0,
          role: 'sentinel',
          status: 'idle',
        },
      ],
      listWorkspaces: () => [{ id: 'workspace-1', name: 'Alpha', path: '/tmp/alpha' }],
      now: () => now,
      writeRunInput,
    })

    await heartbeat.tick()
    expect(writeRunInput).toHaveBeenCalledTimes(1)

    now += 60_000
    await heartbeat.tick()
    expect(writeRunInput).toHaveBeenCalledTimes(1)

    now += 60_000
    await heartbeat.tick()
    expect(writeRunInput).toHaveBeenCalledTimes(2)
  })
})
