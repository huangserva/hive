import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { parseCockpit } from '../../src/server/cockpit-doc.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const setupWorkspace = (overrides: Record<string, string> = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-cockpit-'))
  tempDirs.push(dir)
  const hive = join(dir, '.hive')
  mkdirSync(hive, { recursive: true })
  mkdirSync(join(hive, 'baseline'), { recursive: true })
  mkdirSync(join(hive, 'ideas'), { recursive: true })
  mkdirSync(join(hive, 'decisions'), { recursive: true })
  mkdirSync(join(hive, 'archive'), { recursive: true })
  mkdirSync(join(hive, 'research'), { recursive: true })
  mkdirSync(join(hive, 'templates'), { recursive: true })

  const defaults: Record<string, string> = {
    'plan.md': '---\ntitle: Test\n---\n## 目标\n\nGoal.',
    'open-questions.md':
      '# Open Questions\n\n### 🔴 high\n\n- [ ] **Q1** Urgent question\n\n### 🟠 medium\n\n- [ ] **Q2** Medium question\n\n### 🟢 low\n\n- [ ] **Q3** Low question',
    'ideas/inbox.md':
      '# Ideas Inbox\n\n## inbox\n\n### 2026-05-20\n\n- 🤔 idea: Cool idea\n\n## promoted\n',
    'baseline/README.md': '# Baseline · Test',
    'baseline/module-map.md': '# Module Map\n\nReal content here.',
    'tasks.md': '## In progress\n\n- [ ] Task A\n- [x] Task B\n',
  }
  for (const [path, content] of Object.entries({ ...defaults, ...overrides })) {
    writeFileSync(join(hive, path), content, 'utf8')
  }
  writeFileSync(join(hive, 'research', '2026-05-20-test.md'), '# Test Research\n\nContent.', 'utf8')
  return dir
}

describe('parseCockpit', () => {
  test('aggregates all sections including tasks and research', () => {
    const dir = setupWorkspace()
    const result = parseCockpit(dir)
    expect(result.plan).toBeDefined()
    expect(result.questions).toBeDefined()
    expect(result.ideas).toBeDefined()
    expect(result.baseline).toBeDefined()
    expect(result.decisions).toBeDefined()
    expect(result.archive).toBeDefined()
    expect(result.tasks).toBeDefined()
    expect(result.research).toBeDefined()
    expect(result.generatedAt).toBeGreaterThan(0)
  })

  test('plan has parsed frontmatter', () => {
    const dir = setupWorkspace()
    const result = parseCockpit(dir)
    expect(result.plan.frontmatter.title).toBe('Test')
  })

  test('questions parsed with priority buckets', () => {
    const dir = setupWorkspace()
    const result = parseCockpit(dir)
    expect(result.questions.high).toHaveLength(1)
    expect(result.questions.medium).toHaveLength(1)
    expect(result.questions.low).toHaveLength(1)
  })
})

describe('aiActions', () => {
  test('high question produces question action with high priority', () => {
    const dir = setupWorkspace()
    const result = parseCockpit(dir)
    const questionActions = result.aiActions.filter((a) => a.type === 'question')
    expect(questionActions.length).toBeGreaterThanOrEqual(1)
    expect(questionActions.some((a) => a.priority === 'high')).toBe(true)
    expect(questionActions.some((a) => a.priority === 'medium')).toBe(true)
  })

  test('recent ideas produce promote action with medium priority', () => {
    const dir = setupWorkspace()
    const result = parseCockpit(dir)
    const promoteActions = result.aiActions.filter((a) => a.type === 'promote')
    expect(promoteActions.length).toBeGreaterThanOrEqual(1)
    expect(promoteActions[0]?.targetTab).toBe('ideas')
    expect(promoteActions[0]?.priority).toBe('medium')
  })

  test('draft decisions produce decision action with high priority', () => {
    const dir = setupWorkspace()
    writeFileSync(
      join(dir, '.hive', 'decisions', 'draft-2026-05-20-schema.md'),
      '# Schema Change\n',
      'utf8'
    )
    const result = parseCockpit(dir)
    const decisionActions = result.aiActions.filter((a) => a.type === 'decision')
    expect(decisionActions).toHaveLength(1)
    expect(decisionActions[0]?.priority).toBe('high')
    expect(decisionActions[0]?.targetTab).toBe('decisions')
  })

  test('baseline staleHint produces audit action', () => {
    const dir = setupWorkspace({ 'baseline/module-map.md': '# Module Map\n\n待 AI 起草' })
    const result = parseCockpit(dir)
    const auditActions = result.aiActions.filter((a) => a.type === 'audit')
    expect(auditActions).toHaveLength(1)
    expect(auditActions[0]?.targetTab).toBe('baseline')
    expect(auditActions[0]?.priority).toBe('medium')
  })

  test('actions sorted high before medium before low', () => {
    const dir = setupWorkspace()
    const result = parseCockpit(dir)
    const priorities = result.aiActions.map((a) => a.priority)
    let lastRank = -1
    for (const p of priorities) {
      const rank = p === 'high' ? 0 : p === 'medium' ? 1 : 2
      expect(rank).toBeGreaterThanOrEqual(lastRank)
      lastRank = rank
    }
  })

  test('caps at 10 actions', () => {
    const questions = [
      '# Open Questions',
      '',
      '### 🔴 high',
      '',
      ...Array.from({ length: 15 }, (_, i) => `- [ ] **Q${i + 1}** Question ${i + 1}`),
    ].join('\n')
    const dir = setupWorkspace({ 'open-questions.md': questions })
    const result = parseCockpit(dir)
    expect(result.aiActions.length).toBeLessThanOrEqual(10)
  })
})

describe('parseCockpit tasks and research integration', () => {
  test('tasks section parsed from tasks.md', () => {
    const dir = setupWorkspace({ 'tasks.md': '## In progress\n\n- [ ] Task X\n- [x] Task Y\n' })
    const result = parseCockpit(dir)
    expect(result.tasks.sections).toHaveLength(1)
    expect(result.tasks.totalDone).toBe(1)
    expect(result.tasks.totalOpen).toBe(1)
  })

  test('research section parsed from research/ directory', () => {
    const dir = setupWorkspace()
    const result = parseCockpit(dir)
    expect(result.research.entries).toHaveLength(1)
    expect(result.research.entries[0]?.title).toBe('Test Research')
    expect(result.research.totalCount).toBe(1)
  })

  test('empty tasks.md yields empty sections', () => {
    const dir = setupWorkspace({ 'tasks.md': '' })
    const result = parseCockpit(dir)
    expect(result.tasks.sections).toEqual([])
    expect(result.tasks.totalDone).toBe(0)
    expect(result.tasks.totalOpen).toBe(0)
  })

  test('aiActions does not produce actions for tasks or research', () => {
    const dir = setupWorkspace({
      'tasks.md': '## Open\n\n- [ ] Many tasks\n- [ ] More tasks\n',
    })
    const result = parseCockpit(dir)
    const taskActions = result.aiActions.filter((a) => a.type === 'task')
    const researchActions = result.aiActions.filter((a) => a.type === 'research')
    expect(taskActions).toEqual([])
    expect(researchActions).toEqual([])
  })
})
