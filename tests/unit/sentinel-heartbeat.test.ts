import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { DispatchRecord } from '../../src/server/dispatch-ledger-store.js'
import {
  createSentinelHeartbeat,
  listStaleDecisionDrafts,
  STALE_DECISION_DRAFT_MS,
} from '../../src/server/sentinel-heartbeat.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const setupWorkspace = () => {
  const workspace = mkdtempSync(join(tmpdir(), 'hive-sentinel-'))
  tempDirs.push(workspace)
  mkdirSync(join(workspace, '.hive', 'decisions'), { recursive: true })
  return workspace
}

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

  test('reconciles every worker status before building heartbeat payload', async () => {
    const writeRunInput = vi.fn()
    const reconcileAgentStatus = vi.fn()
    const workers = [
      {
        id: 'workspace-1:sentinel',
        name: 'Sentinel',
        pendingTaskCount: 0,
        role: 'sentinel' as const,
        status: 'idle' as const,
      },
      {
        id: 'workspace-1:coder',
        name: 'Coder',
        pendingTaskCount: 1,
        role: 'coder' as const,
        status: 'working' as const,
      },
    ]
    const heartbeat = createSentinelHeartbeat({
      getActiveRunByAgentId: (_workspaceId, agentId) =>
        agentId === 'workspace-1:sentinel' ? { runId: 'run-sentinel' } : undefined,
      getWorkerConfig: () => ({}),
      listWorkers: () => workers,
      listWorkspaces: () => [{ id: 'workspace-1', name: 'Alpha', path: '/tmp/alpha' }],
      reconcileAgentStatus,
      writeRunInput,
    })

    await heartbeat.tick()

    expect(reconcileAgentStatus).toHaveBeenCalledWith('workspace-1', 'workspace-1:sentinel')
    expect(reconcileAgentStatus).toHaveBeenCalledWith('workspace-1', 'workspace-1:coder')
    expect(reconcileAgentStatus).toHaveBeenCalledTimes(2)
    expect(writeRunInput).toHaveBeenCalledTimes(1)
    expect(reconcileAgentStatus.mock.invocationCallOrder[0]).toBeLessThan(
      writeRunInput.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER
    )
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
      listOpenDispatches: (): DispatchRecord[] => [
        {
          acceptVerdict: null,
          artifacts: [],
          createdAt: now - 20 * 60 * 1000,
          deliveredAt: null,
          fromAgentId: 'workspace-1:orchestrator',
          id: 'dispatch-stale',
          reportedAt: null,
          reportText: null,
          reviewStatus: null,
          reviewsDispatchId: null,
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
      listOpenDispatches: (): DispatchRecord[] => [
        {
          acceptVerdict: null,
          artifacts: [],
          createdAt: now - 20 * 60 * 1000,
          deliveredAt: null,
          fromAgentId: 'workspace-1:orchestrator',
          id: 'dispatch-running',
          reportedAt: null,
          reportText: null,
          reviewStatus: null,
          reviewsDispatchId: null,
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
      listOpenDispatches: (): DispatchRecord[] => [
        {
          acceptVerdict: null,
          artifacts: [],
          createdAt: now - 35 * 60 * 1000,
          deliveredAt: null,
          fromAgentId: 'workspace-1:orchestrator',
          id: 'dispatch-stale-working',
          reportedAt: null,
          reportText: null,
          reviewStatus: null,
          reviewsDispatchId: null,
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

  test('includes stale decision drafts in heartbeat payload', async () => {
    const now = Date.parse('2026-06-01T12:00:00Z')
    const workspacePath = setupWorkspace()
    writeFileSync(
      join(workspacePath, '.hive', 'decisions', 'draft-2026-05-30-mobile-worker.md'),
      '# 决策：手机新增 Worker\n\n**状态**: 草稿\n**日期**: 2026-05-30\n',
      'utf8'
    )
    const writeRunInput = vi.fn()
    const heartbeat = createSentinelHeartbeat({
      getActiveRunByAgentId: () => ({ runId: 'run-sentinel' }),
      getWorkerConfig: () => ({}),
      listWorkers: () => [
        {
          id: 'workspace-1:sentinel',
          name: 'Sentinel',
          pendingTaskCount: 0,
          role: 'sentinel',
          status: 'idle',
        },
      ],
      listWorkspaces: () => [{ id: 'workspace-1', name: 'Alpha', path: workspacePath }],
      now: () => now,
      writeRunInput,
    })

    await heartbeat.tick()

    const payload = writeRunInput.mock.calls[0]?.[1] as string
    expect(payload).toContain('陈旧决策草案：')
    expect(payload).toContain('手机新增 Worker')
    expect(payload).toContain('已挂 2 天')
  })

  test('surfaces sentinel rule alerts every tick and only renotifies when severity upgrades', async () => {
    let now = 1_700_001_000_000
    let dispatchStatus: DispatchRecord['status'] = 'report_overdue'
    const submittedAt = now - 9 * 60_000
    const writeRunInput = vi.fn()
    const surfaceSentinelAlert = vi.fn()
    const heartbeat = createSentinelHeartbeat({
      getActiveRunByAgentId: () => ({ runId: 'run-sentinel' }),
      getWorkerConfig: () => ({ heartbeat_interval_ms: 30 * 60 * 1000 }),
      listOpenDispatches: (): DispatchRecord[] => [
        {
          acceptVerdict: null,
          artifacts: [],
          createdAt: now - 60_000,
          deliveredAt: null,
          fromAgentId: 'workspace-1:orchestrator',
          id: 'dispatch-overdue',
          reportedAt: null,
          reportText: null,
          reviewStatus: null,
          reviewsDispatchId: null,
          sequence: 1,
          status: dispatchStatus,
          submittedAt,
          text: 'overdue task',
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
      surfaceSentinelAlert,
      writeRunInput,
    })

    await heartbeat.tick()
    await heartbeat.tick()
    expect(writeRunInput).toHaveBeenCalledTimes(1)
    expect(surfaceSentinelAlert).toHaveBeenCalledTimes(1)
    expect(surfaceSentinelAlert.mock.calls[0]?.[1]).toMatchObject({
      dedupeKey: 'workspace-1:R2:dispatch-overdue',
      tier: 'warn',
    })

    now += 2 * 60_000
    await heartbeat.tick()
    expect(writeRunInput).toHaveBeenCalledTimes(1)
    expect(surfaceSentinelAlert).toHaveBeenCalledTimes(2)
    expect(surfaceSentinelAlert.mock.calls[1]?.[1]).toMatchObject({
      dedupeKey: 'workspace-1:R2:dispatch-overdue',
      tier: 'critical',
    })

    dispatchStatus = 'reported'
    await heartbeat.tick()
    now += 60_000
    dispatchStatus = 'report_overdue'
    await heartbeat.tick()
    expect(surfaceSentinelAlert).toHaveBeenCalledTimes(3)
  })

  test('syncs active sentinel alerts so resolved alerts disappear and recurrence can notify again', async () => {
    let now = 1_700_001_000_000
    let dispatchStatus: DispatchRecord['status'] = 'report_overdue'
    const submittedAt = now - 11 * 60_000
    const activeAlertsByWorkspace = new Map<string, unknown[]>()
    const surfaceSentinelAlert = vi.fn()
    const heartbeat = createSentinelHeartbeat({
      getActiveRunByAgentId: () => ({ runId: 'run-sentinel' }),
      getWorkerConfig: () => ({ heartbeat_interval_ms: 30 * 60 * 1000 }),
      listOpenDispatches: (): DispatchRecord[] =>
        dispatchStatus === 'reported'
          ? []
          : [
              {
                acceptVerdict: null,
                artifacts: [],
                createdAt: now - 60_000,
                deliveredAt: null,
                fromAgentId: 'workspace-1:orchestrator',
                id: 'dispatch-overdue',
                reportedAt: null,
                reportText: null,
                reviewStatus: null,
                reviewsDispatchId: null,
                sequence: 1,
                status: dispatchStatus,
                submittedAt,
                text: 'overdue task',
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
      surfaceSentinelAlert,
      syncSentinelAlerts: (workspaceId, alerts) => {
        activeAlertsByWorkspace.set(workspaceId, alerts)
      },
      writeRunInput: vi.fn(),
    })

    await heartbeat.tick()
    expect(activeAlertsByWorkspace.get('workspace-1')).toHaveLength(1)
    expect(surfaceSentinelAlert).toHaveBeenCalledTimes(1)

    dispatchStatus = 'reported'
    await heartbeat.tick()
    expect(activeAlertsByWorkspace.get('workspace-1')).toEqual([])

    now += 60_000
    dispatchStatus = 'report_overdue'
    await heartbeat.tick()
    expect(activeAlertsByWorkspace.get('workspace-1')).toHaveLength(1)
    expect(surfaceSentinelAlert).toHaveBeenCalledTimes(2)
  })
})

describe('listStaleDecisionDrafts', () => {
  test('returns drafts older than the threshold using the markdown date first', () => {
    const now = Date.parse('2026-06-01T12:00:00Z')
    const workspacePath = setupWorkspace()
    writeFileSync(
      join(workspacePath, '.hive', 'decisions', 'draft-2026-05-30-mobile-worker.md'),
      '# 决策：手机新增 Worker\n\n**状态**: 草稿\n**日期**: 2026-05-30\n',
      'utf8'
    )

    const drafts = listStaleDecisionDrafts(workspacePath, now)

    expect(drafts).toEqual([
      {
        daysAgo: 2,
        filename: 'draft-2026-05-30-mobile-worker.md',
        title: '决策：手机新增 Worker',
      },
    ])
  })

  test('does not return drafts younger than the threshold', () => {
    const now = Date.parse('2026-06-01T12:00:00Z')
    const workspacePath = setupWorkspace()
    writeFileSync(
      join(workspacePath, '.hive', 'decisions', 'draft-2026-06-01-push.md'),
      '# 决策：Push channel\n\n**状态**: 草稿\n**日期**: 2026-06-01\n',
      'utf8'
    )

    expect(listStaleDecisionDrafts(workspacePath, now)).toEqual([])
  })

  test('ignores adopted and superseded decisions even when old', () => {
    const now = Date.parse('2026-06-01T12:00:00Z')
    const workspacePath = setupWorkspace()
    writeFileSync(
      join(workspacePath, '.hive', 'decisions', 'draft-2026-05-20-adopted.md'),
      '# 决策：Adopted\n\n**状态**: 已采纳\n**日期**: 2026-05-20\n',
      'utf8'
    )
    writeFileSync(
      join(workspacePath, '.hive', 'decisions', '2026-05-20-old.md'),
      '# 决策：Old\n\n**状态**: 废弃\n**日期**: 2026-05-20\n',
      'utf8'
    )

    expect(listStaleDecisionDrafts(workspacePath, now)).toEqual([])
  })

  test('returns an empty list when there are no drafts', () => {
    const workspacePath = setupWorkspace()

    expect(listStaleDecisionDrafts(workspacePath, Date.parse('2026-06-01T12:00:00Z'))).toEqual([])
  })

  test('falls back to file mtime when a draft has no markdown date', () => {
    const now = Date.parse('2026-06-01T12:00:00Z')
    const workspacePath = setupWorkspace()
    const draftPath = join(workspacePath, '.hive', 'decisions', 'draft-2026-06-01-no-date.md')
    writeFileSync(draftPath, '# 决策：No date\n\n**状态**: 草稿\n', 'utf8')
    const mtime = new Date(now - STALE_DECISION_DRAFT_MS - 60_000)
    utimesSync(draftPath, mtime, mtime)

    const drafts = listStaleDecisionDrafts(workspacePath, now)

    expect(drafts).toEqual([
      {
        daysAgo: 2,
        filename: 'draft-2026-06-01-no-date.md',
        title: '决策：No date',
      },
    ])
  })
})
