import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { checkTasksNarrativeNudge } from '../../src/server/tasks-narrative-nudge.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const setupWorkspace = (input: { plan?: string; tasks?: string }) => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-tasks-nudge-'))
  tempDirs.push(dir)
  const hiveDir = join(dir, '.hive')
  mkdirSync(hiveDir, { recursive: true })
  if (input.tasks !== undefined) writeFileSync(join(hiveDir, 'tasks.md'), input.tasks, 'utf8')
  if (input.plan !== undefined) writeFileSync(join(hiveDir, 'plan.md'), input.plan, 'utf8')
  return dir
}

const defaultPlan = [
  '## 里程碑',
  '',
  '### M18 · Previous · shipped 2026-05-20',
  '',
  '- [x] done',
  '',
  '### M19 · Current · in_progress',
  '',
].join('\n')

describe('checkTasksNarrativeNudge', () => {
  test('rule 1 nudges when a milestone is dispatched before In Progress narrative mentions it', () => {
    const workspacePath = setupWorkspace({
      plan: defaultPlan,
      tasks: [
        '# Tasks',
        '',
        '## In progress',
        '',
        '> 当前 sprint: M18 wrap-up',
        '',
        '## Done',
      ].join('\n'),
    })

    const result = checkTasksNarrativeNudge(
      'M19a: implement mobile dashboard',
      workspacePath,
      1,
      Date.now()
    )

    expect(result).toEqual(
      expect.objectContaining({
        rule: 1,
        shouldNudge: true,
      })
    )
    expect(result.reason).toContain('M19a 首次 dispatch')
    expect(result.reason).toContain('tasks.md 缺 sprint narrative 段')
  })

  test('rule 1 does not nudge when In Progress narrative already mentions the milestone', () => {
    const workspacePath = setupWorkspace({
      plan: defaultPlan,
      tasks: ['# Tasks', '', '## In progress', '', '> 当前 sprint: M19a mobile dashboard', ''].join(
        '\n'
      ),
    })

    const result = checkTasksNarrativeNudge(
      'M19a: implement mobile dashboard',
      workspacePath,
      1,
      Date.now()
    )

    expect(result.shouldNudge).toBe(false)
    expect(result.rule).toBeNull()
  })

  test('rule 2 nudges when dispatch lines accumulate after stale narrative mtime', () => {
    const workspacePath = setupWorkspace({
      plan: defaultPlan,
      tasks: ['# Tasks', '', '## In progress', '', '> Current sprint: M19', ''].join('\n'),
    })
    const staleMtime = Date.now() - 31 * 60 * 1000

    const result = checkTasksNarrativeNudge('Implement regular task', workspacePath, 3, staleMtime)

    expect(result).toEqual(
      expect.objectContaining({
        rule: 2,
        shouldNudge: true,
      })
    )
    expect(result.reason).toContain('3 条 dispatch 已累积未组织')
  })

  test('rule 2 does not nudge before three dispatches accumulate', () => {
    const workspacePath = setupWorkspace({
      plan: defaultPlan,
      tasks: ['# Tasks', '', '## In progress', '', '> Current sprint: M19', ''].join('\n'),
    })
    const staleMtime = Date.now() - 31 * 60 * 1000

    const result = checkTasksNarrativeNudge('Implement regular task', workspacePath, 2, staleMtime)

    expect(result.shouldNudge).toBe(false)
  })

  test('rule 3 nudges when In Progress narrative still references a shipped milestone', () => {
    const workspacePath = setupWorkspace({
      plan: defaultPlan,
      tasks: ['# Tasks', '', '## In progress', '', '> M18 final cleanup', '', '## Done'].join('\n'),
    })

    const result = checkTasksNarrativeNudge('Unrelated dispatch', workspacePath, 1, Date.now())

    expect(result).toEqual(
      expect.objectContaining({
        rule: 3,
        shouldNudge: true,
      })
    )
    expect(result.reason).toContain('narrative 引用 M18 已 shipped')
  })

  test('does not nudge when tasks.md is absent', () => {
    const workspacePath = setupWorkspace({ plan: defaultPlan })

    const result = checkTasksNarrativeNudge(
      'M20: implement missing file case',
      workspacePath,
      3,
      Date.now() - 31 * 60 * 1000
    )

    expect(result.shouldNudge).toBe(false)
    expect(result.reason).toBeNull()
    expect(result.rule).toBeNull()
  })

  test('uses an explicit mtime argument rather than stat mtime for backlog checks', () => {
    const workspacePath = setupWorkspace({
      plan: defaultPlan,
      tasks: ['# Tasks', '', '## In progress', '', '> Current sprint: M19', ''].join('\n'),
    })
    const fresh = new Date()
    utimesSync(join(workspacePath, '.hive', 'tasks.md'), fresh, fresh)

    const result = checkTasksNarrativeNudge(
      'Implement regular task',
      workspacePath,
      3,
      Date.now() - 31 * 60 * 1000
    )

    expect(result.shouldNudge).toBe(true)
    expect(result.rule).toBe(2)
  })
})
