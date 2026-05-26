import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'
import { buildMilestoneCompletionNudge } from '../../src/server/milestone-completion-nudge.js'
import {
  createMilestoneCompletionTrigger,
  detectNewlyShippedMilestones,
} from '../../src/server/milestone-completion-trigger.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const planWith = (heading: string, body = '') =>
  ['## 里程碑', '', `### ${heading}`, '', body].join('\n')

const setupWorkspace = (input: { tasks?: string; baselineStub?: boolean } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-milestone-nudge-'))
  tempDirs.push(dir)
  const hive = join(dir, '.hive')
  mkdirSync(join(hive, 'baseline'), { recursive: true })
  writeFileSync(
    join(hive, 'tasks.md'),
    input.tasks ?? '# Tasks\n\n## In progress\n\n## Done\n',
    'utf8'
  )
  writeFileSync(join(hive, 'baseline', 'README.md'), '# Baseline\n', 'utf8')
  for (const filename of [
    'module-map.md',
    'runtime-flows.md',
    'state-storage.md',
    'test-gates.md',
    'risk-hotspots.md',
  ]) {
    writeFileSync(
      join(hive, 'baseline', filename),
      filename === 'module-map.md' && input.baselineStub
        ? '# Module Map\n\n待 AI 起草\n'
        : `# ${filename}\n\nFresh enough.\n`,
      'utf8'
    )
  }
  return dir
}

describe('detectNewlyShippedMilestones', () => {
  test('detects a milestone that changed to shipped', () => {
    const previous = planWith('M19f · beta distribution · in_progress')
    const current = planWith('M19f · beta distribution · shipped 2026-05-26', '`abc1234`')

    expect(detectNewlyShippedMilestones(previous, current)).toEqual([
      {
        commitHash: 'abc1234',
        milestone: 'M19f',
        title: 'beta distribution',
      },
    ])
  })

  test('does not return milestones that were already shipped', () => {
    const previous = planWith('M19f · beta distribution · shipped 2026-05-26')
    const current = planWith('M19f · beta distribution · shipped 2026-05-26', '`abc1234`')

    expect(detectNewlyShippedMilestones(previous, current)).toEqual([])
  })

  test('extracts commit hash from the shipped milestone heading', () => {
    const previous = planWith('M19f · beta distribution · in_progress')
    const current = planWith('M19f · beta distribution · shipped 2026-05-26 `def5678`')

    expect(detectNewlyShippedMilestones(previous, current)[0]?.commitHash).toBe('def5678')
  })

  test('returns empty when plan content has no shipped status transition', () => {
    const previous = planWith('M19f · beta distribution · in_progress')
    const current = planWith('M19f · beta distribution · in_progress', '- [x] docs')

    expect(detectNewlyShippedMilestones(previous, current)).toEqual([])
  })
})

describe('buildMilestoneCompletionNudge', () => {
  test('adds a tasks.md action when In Progress still references the milestone', () => {
    const workspacePath = setupWorkspace({
      tasks:
        '# Tasks\n\n## In progress\n\n- [ ] **赵云** dispatch `12345678` — M19f beta docs\n\n## Done\n',
    })

    const nudge = buildMilestoneCompletionNudge(
      { commitHash: 'abc1234', milestone: 'M19f', title: 'beta distribution' },
      workspacePath
    )

    expect(nudge.actions).toContain('tasks.md：将 M19f 相关 dispatch 行归档到 Done 段')
    expect(nudge.message).toContain('[Hive 系统消息：milestone 完成 housekeeping]')
    expect(nudge.message).toContain('M19f 已标记 shipped')
  })

  test('adds a baseline action when baseline parser reports stale files', () => {
    const workspacePath = setupWorkspace({ baselineStub: true })

    const nudge = buildMilestoneCompletionNudge(
      { commitHash: 'abc1234', milestone: 'M19f', title: 'beta distribution' },
      workspacePath
    )

    expect(nudge.actions).toContain(
      'baseline 体检：检查 module-map.md / test-gates.md 是否需要更新（1 baseline files still need drafting）'
    )
  })

  test('adds a plan.md action when the shipped event has no commit hash', () => {
    const workspacePath = setupWorkspace()

    const nudge = buildMilestoneCompletionNudge(
      { commitHash: null, milestone: 'M19f', title: 'beta distribution' },
      workspacePath
    )

    expect(nudge.actions).toContain('plan.md：确认 M19f shipped 行包含 commit hash')
  })

  test('returns no actions when housekeeping is already clean', () => {
    const workspacePath = setupWorkspace()

    const nudge = buildMilestoneCompletionNudge(
      { commitHash: 'abc1234', milestone: 'M19f', title: 'beta distribution' },
      workspacePath
    )

    expect(nudge.actions).toEqual([])
    expect(nudge.message).toBeNull()
  })
})

describe('createMilestoneCompletionTrigger', () => {
  test('deduplicates the same shipped milestone within one runtime session', () => {
    const workspacePath = setupWorkspace({
      tasks: '# Tasks\n\n## In progress\n\n- [ ] M19f beta docs\n\n## Done\n',
    })
    const injected: string[] = []
    const trigger = createMilestoneCompletionTrigger({
      getWorkspacePath: () => workspacePath,
      injectNudge: (_workspaceId, message) => injected.push(message),
    })
    const previous = planWith('M19f · beta distribution · in_progress')
    const current = planWith('M19f · beta distribution · shipped 2026-05-26')

    trigger.handlePlanUpdated('workspace-1', previous)
    trigger.handlePlanUpdated('workspace-1', current)
    trigger.handlePlanUpdated('workspace-1', previous)
    trigger.handlePlanUpdated('workspace-1', current)

    expect(injected).toHaveLength(1)
    expect(injected[0]).toContain('M19f 已标记 shipped')
  })
})
