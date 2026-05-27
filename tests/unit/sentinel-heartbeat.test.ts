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

  test('includes stale open dispatches whose target worker is stopped', async () => {
    const writeRunInput = vi.fn()
    const now = 1_700_001_000_000
    const heartbeat = createSentinelHeartbeat({
      getActiveRunByAgentId: () => ({ runId: 'run-sentinel' }),
      getWorkerConfig: () => ({}),
      listOpenDispatches: () => [
        {
          artifacts: [],
          createdAt: now - 20 * 60 * 1000,
          deliveredAt: null,
          fromAgentId: 'workspace-1:orchestrator',
          id: 'dispatch-stale',
          reportedAt: null,
          reportText: null,
          sequence: 1,
          status: 'submitted',
          submittedAt: now - 20 * 60 * 1000,
          text: 'stale task',
          toAgentId: 'workspace-1:coder',
          workspaceId: 'workspace-1',
        },
      ],
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
          pendingTaskCount: 1,
          role: 'coder',
          status: 'stopped',
        },
      ],
      listWorkspaces: () => [{ id: 'workspace-1', name: 'Alpha', path: '/tmp/alpha' }],
      now: () => now,
      writeRunInput,
    })

    await heartbeat.tick()

    const payload = writeRunInput.mock.calls[0]?.[1] as string
    expect(payload).toContain('Orphaned dispatches (worker stopped but dispatch still open):')
    expect(payload).toContain('Coder: dispatch dispatch-stale, submitted 20 min ago')
  })

  test('does not report stale dispatches while the target worker is still running', async () => {
    const writeRunInput = vi.fn()
    const now = 1_700_001_000_000
    const heartbeat = createSentinelHeartbeat({
      getActiveRunByAgentId: () => ({ runId: 'run-sentinel' }),
      getWorkerConfig: () => ({}),
      listOpenDispatches: () => [
        {
          artifacts: [],
          createdAt: now - 20 * 60 * 1000,
          deliveredAt: null,
          fromAgentId: 'workspace-1:orchestrator',
          id: 'dispatch-running',
          reportedAt: null,
          reportText: null,
          sequence: 1,
          status: 'submitted',
          submittedAt: now - 20 * 60 * 1000,
          text: 'running task',
          toAgentId: 'workspace-1:coder',
          workspaceId: 'workspace-1',
        },
      ],
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
          pendingTaskCount: 1,
          role: 'coder',
          status: 'working',
        },
      ],
      listWorkspaces: () => [{ id: 'workspace-1', name: 'Alpha', path: '/tmp/alpha' }],
      now: () => now,
      writeRunInput,
    })

    await heartbeat.tick()

    const payload = writeRunInput.mock.calls[0]?.[1] as string
    expect(payload).not.toContain('Orphaned dispatches')
    expect(payload).not.toContain('dispatch-running')
  })

  test('reports stale dispatches to working worker after 30 minutes', async () => {
    const writeRunInput = vi.fn()
    const now = 1_700_001_000_000
    const heartbeat = createSentinelHeartbeat({
      getActiveRunByAgentId: () => ({ runId: 'run-sentinel' }),
      getWorkerConfig: () => ({}),
      listOpenDispatches: () => [
        {
          artifacts: [],
          createdAt: now - 35 * 60 * 1000,
          deliveredAt: null,
          fromAgentId: 'workspace-1:orchestrator',
          id: 'dispatch-stale-working',
          reportedAt: null,
          reportText: null,
          sequence: 1,
          status: 'submitted',
          submittedAt: now - 35 * 60 * 1000,
          text: 'long running task',
          toAgentId: 'workspace-1:coder',
          workspaceId: 'workspace-1',
        },
      ],
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
          pendingTaskCount: 1,
          role: 'coder',
          status: 'working',
        },
      ],
      listWorkspaces: () => [{ id: 'workspace-1', name: 'Alpha', path: '/tmp/alpha' }],
      now: () => now,
      writeRunInput,
    })

    await heartbeat.tick()

    const payload = writeRunInput.mock.calls[0]?.[1] as string
    expect(payload).toContain('Orphaned dispatches')
    expect(payload).toContain('Coder: dispatch dispatch-stale-working, submitted 35 min ago')
  })

  test('includes archive audit and cross-workspace drift findings in heartbeat payload', async () => {
    const writeRunInput = vi.fn()
    const heartbeat = createSentinelHeartbeat({
      detectCrossWorkspaceDrift: () => [
        {
          kind: 'schema-version',
          message: 'schema version drift: Alpha=27, Beta=25',
        },
      ],
      getActiveRunByAgentId: () => ({ runId: 'run-sentinel' }),
      getWorkerConfig: () => ({}),
      inspectArchiveAudit: () => [
        {
          archiveMonth: '2026-05',
          kind: 'tasks-done',
          message: 'tasks.md Done 段已 201 行，建议归档到 .hive/archive/2026-05/',
        },
      ],
      listWorkers: () => [
        {
          id: 'workspace-1:sentinel',
          name: 'Sentinel',
          pendingTaskCount: 0,
          role: 'sentinel',
          status: 'idle',
        },
      ],
      listWorkspaces: () => [
        { id: 'workspace-1', name: 'Alpha', path: '/tmp/alpha' },
        { id: 'workspace-2', name: 'Beta', path: '/tmp/beta' },
      ],
      writeRunInput,
    })

    await heartbeat.tick()

    const payload = writeRunInput.mock.calls[0]?.[1] as string
    expect(payload).toContain('[Hive 系统消息：archive audit]')
    expect(payload).toContain('tasks.md Done 段已 201 行')
    expect(payload).toContain('[Hive 系统消息：cross-workspace drift]')
    expect(payload).toContain('schema version drift: Alpha=27, Beta=25')
  })

  test('includes cockpit fidelity findings in heartbeat payload', async () => {
    const writeRunInput = vi.fn()
    const heartbeat = createSentinelHeartbeat({
      getActiveRunByAgentId: () => ({ runId: 'run-sentinel' }),
      getWorkerConfig: () => ({}),
      inspectCockpitFidelity: () => ({
        checkedAt: 1_700_000_000_000,
        findings: [
          {
            detail: 'm20-dashboard.html is missing paired research note in .hive/research.',
            file: 'm20-dashboard.html',
            type: 'report_missing_research',
          },
          {
            detail:
              '2026-05-26-ui-quality-standard.md uses YAML frontmatter without inline metadata.',
            file: '2026-05-26-ui-quality-standard.md',
            type: 'decision_format_warning',
          },
        ],
      }),
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
      writeRunInput,
    })

    await heartbeat.tick()

    const payload = writeRunInput.mock.calls[0]?.[1] as string
    expect(payload).toContain('⚠️ Cockpit 保真度问题：')
    expect(payload).toContain(
      '- [report_missing_research] m20-dashboard.html m20-dashboard.html is missing paired research note'
    )
    expect(payload).toContain(
      '- [decision_format_warning] 2026-05-26-ui-quality-standard.md 2026-05-26-ui-quality-standard.md uses YAML frontmatter'
    )
  })
})
