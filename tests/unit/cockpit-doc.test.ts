import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { parseCockpit } from '../../src/server/cockpit-doc.js'
import { clearPmFileCache } from '../../src/server/pm-file-cache.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  clearPmFileCache()
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
  mkdirSync(join(hive, 'reports'), { recursive: true })
  mkdirSync(join(hive, 'templates'), { recursive: true })

  const defaults: Record<string, string> = {
    'plan.md': '---\ntitle: Test\n---\n## 目标\n\nGoal.',
    'open-questions.md':
      '# Open Questions\n\n### 🔴 high\n\n- [ ] **Q1** Urgent question\n\n### 🟠 medium\n\n- [ ] **Q2** Medium question\n\n### 🟢 low\n\n- [ ] **Q3** Low question',
    'ideas/inbox.md': `# Ideas Inbox\n\n## inbox\n\n### ${new Date().toISOString().slice(0, 10)}\n\n- 🤔 idea: Cool idea\n\n## promoted\n`,
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
    expect(result.reports).toBeDefined()
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

  test('promote actions only use top-level ideas, not indented child bullets', () => {
    const today = new Date().toISOString().slice(0, 10)
    const dir = setupWorkspace({
      'ideas/inbox.md': `# Ideas Inbox

## inbox

### ${today}

- 🤔 idea: provider catalog
  - 详细能力声明
  - 价值：减少 preset 分支
- idea: voice control

## promoted
`,
    })
    const result = parseCockpit(dir)
    const promoteActions = result.aiActions.filter((a) => a.type === 'promote')

    expect(promoteActions.map((action) => action.text)).toEqual([
      'provider catalog',
      'voice control',
    ])
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

  test('orphan report produces high-priority research audit action', () => {
    const dir = setupWorkspace()
    writeFileSync(
      join(dir, '.hive', 'reports', '2026-05-24-orphan-research.html'),
      '<html><body>Report</body></html>',
      'utf8'
    )

    const result = parseCockpit(dir)
    const auditActions = result.aiActions.filter((a) => a.type === 'audit')

    expect(auditActions).toContainEqual(
      expect.objectContaining({
        action: '补 note',
        priority: 'high',
        targetTab: 'research',
        text: expect.stringContaining('reports/2026-05-24-orphan-research.html'),
      })
    )
  })

  test('cancelled dispatch produces a conservative handoff playbook action', () => {
    const dir = setupWorkspace({
      'tasks.md':
        '## In progress\n\n- [~] **关羽** dispatch `abc12345` — paseo v3 HTML stuck ⊘ PTY stuck, needs rescue\n',
    })

    const result = parseCockpit(dir)
    const playbookActions = result.aiActions.filter((a) => a.type === 'playbook')

    expect(playbookActions).toContainEqual(
      expect.objectContaining({
        action: '准备',
        id: 'handoff:abc12345',
        priority: 'medium',
        targetTab: 'tasks',
        text: expect.stringContaining('准备 handoff brief'),
      })
    )
  })

  test('failed verifier dispatch produces a conservative loop playbook action', () => {
    const dir = setupWorkspace({
      'tasks.md':
        '## Done\n\n- [x] **赵云** dispatch `def67890` — pnpm test failed after retries; blocked until verifier passes\n',
    })

    const result = parseCockpit(dir)
    const playbookActions = result.aiActions.filter((a) => a.type === 'playbook')

    expect(playbookActions).toContainEqual(
      expect.objectContaining({
        action: '准备',
        id: 'loop:def67890',
        priority: 'medium',
        targetTab: 'tasks',
        text: expect.stringContaining('准备 loop brief'),
      })
    )
  })

  test('loop playbook action does not trigger for non-verifier research failure', () => {
    const dir = setupWorkspace({
      'tasks.md':
        '## Done\n\n- [x] **关羽** dispatch `fedcba98` — paseo 调研 blocked because external docs are unclear\n',
    })

    const result = parseCockpit(dir)
    const loopActions = result.aiActions.filter((a) => a.id.startsWith('loop:'))
    expect(loopActions).toEqual([])
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

  test('cached PM file reads invalidate when a research file mtime changes', () => {
    const dir = setupWorkspace()
    const researchPath = join(dir, '.hive', 'research', '2026-05-20-test.md')
    expect(parseCockpit(dir).research.entries[0]?.title).toBe('Test Research')

    writeFileSync(researchPath, '# Updated Research\n\nContent.', 'utf8')
    const updatedMtime = statSync(researchPath).mtime
    const fs = require('node:fs') as typeof import('node:fs')
    fs.utimesSync(researchPath, updatedMtime, new Date(updatedMtime.getTime() + 2000))

    expect(parseCockpit(dir).research.entries[0]?.title).toBe('Updated Research')
  })

  test('reports section parsed from reports/ directory', () => {
    const dir = setupWorkspace()
    writeFileSync(
      join(dir, '.hive', 'reports', '2026-05-25-cockpit-report.html'),
      '<html><head><title>Cockpit Report</title></head><body>Report</body></html>',
      'utf8'
    )

    const result = parseCockpit(dir)
    expect(result.reports.entries).toHaveLength(1)
    expect(result.reports.entries[0]?.title).toBe('Cockpit Report')
    expect(result.reports.totalCount).toBe(1)
  })

  test('empty tasks.md yields empty sections', () => {
    const dir = setupWorkspace({ 'tasks.md': '' })
    const result = parseCockpit(dir)
    expect(result.tasks.sections).toEqual([])
    expect(result.tasks.totalDone).toBe(0)
    expect(result.tasks.totalOpen).toBe(0)
  })

  test('aiActions does not produce actions for ordinary tasks or research', () => {
    const dir = setupWorkspace({
      'tasks.md': '## Open\n\n- [ ] Many tasks\n- [ ] More tasks\n',
    })
    const result = parseCockpit(dir)
    const playbookActions = result.aiActions.filter((a) => a.type === 'playbook')
    const researchActions = result.aiActions.filter((a) => a.targetTab === 'research')
    expect(playbookActions).toEqual([])
    expect(researchActions).toEqual([])
  })

  describe('missing_impl_milestone aiAction', () => {
    test('generates action when shipped design milestone has no matching impl milestone', () => {
      const dir = setupWorkspace({
        'plan.md': `---
title: Test
---
## 目标

Goal.

## 里程碑

### M19i · spec 设计 · shipped

- [x] Write design doc

### M22 · unrelated feature · open

- [ ] Do something
`,
      })
      const result = parseCockpit(dir)
      const implActions = result.aiActions.filter((a) => a.type === 'missing_impl_milestone')
      expect(implActions).toHaveLength(1)
      expect(implActions[0]?.id).toBe('missing-impl:M19i')
      expect(implActions[0]?.priority).toBe('high')
      expect(implActions[0]?.targetTab).toBe('plan')
      expect(implActions[0]?.text).toContain('M19i')
    })

    test('does not generate action when matching impl milestone exists', () => {
      const dir = setupWorkspace({
        'plan.md': `---
title: Test
---
## 目标

Goal.

## 里程碑

### M19i · spec 设计 · shipped

- [x] Write design doc

### M19j · impl implementation · open

- [ ] Implement it
`,
      })
      const result = parseCockpit(dir)
      const implActions = result.aiActions.filter((a) => a.type === 'missing_impl_milestone')
      expect(implActions).toHaveLength(0)
    })
  })
})

describe('aiActions noise filtering — resolved items must not appear', () => {
  test('adopted (non-draft) decision does not produce a confirm action', () => {
    const dir = setupWorkspace()
    writeFileSync(
      join(dir, '.hive', 'decisions', '2026-05-20-schema.md'),
      '# Schema Change\n\n**状态**: 已采纳\n',
      'utf8'
    )
    const result = parseCockpit(dir)
    expect(result.aiActions.filter((a) => a.type === 'decision')).toEqual([])
  })

  test('draft- file already marked 已采纳 in content does not produce a confirm action', () => {
    const dir = setupWorkspace()
    // 手动把状态改成已采纳但没改文件名（仍叫 draft-）——不该再当待确认草稿。
    writeFileSync(
      join(dir, '.hive', 'decisions', 'draft-2026-05-20-schema.md'),
      '# Schema Change\n\n**状态**: 已采纳\n**确认日期**: 2026-05-21\n',
      'utf8'
    )
    const result = parseCockpit(dir)
    expect(result.aiActions.filter((a) => a.type === 'decision')).toEqual([])
  })

  test('promoted (struck-through) idea in inbox does not produce a promote action', () => {
    const today = new Date().toISOString().slice(0, 10)
    const dir = setupWorkspace({
      'ideas/inbox.md': `# Ideas Inbox\n\n## inbox\n\n### ${today}\n\n- ~~🤔 idea: old idea~~ → promoted to plan\n\n## promoted\n`,
    })
    const result = parseCockpit(dir)
    expect(result.aiActions.filter((a) => a.type === 'promote')).toEqual([])
  })

  test('shipped-marked idea in inbox does not produce a promote action', () => {
    const today = new Date().toISOString().slice(0, 10)
    const dir = setupWorkspace({
      'ideas/inbox.md': `# Ideas Inbox\n\n## inbox\n\n### ${today}\n\n- 🤔 idea: sentinel card (shipped M20)\n\n## promoted\n`,
    })
    const result = parseCockpit(dir)
    expect(result.aiActions.filter((a) => a.type === 'promote')).toEqual([])
  })

  test('cancelled dispatch with an orphan/resolved reason does not produce a handoff action', () => {
    const dir = setupWorkspace({
      'tasks.md':
        '## In progress\n\n- [~] **马超** dispatch `28853152` — mobile sentinel card ⊘ orphan-submitted: worker stopped without reporting\n',
    })
    const result = parseCockpit(dir)
    expect(result.aiActions.filter((a) => a.id.startsWith('handoff:'))).toEqual([])
  })

  test('cancelled dispatch marked superseded does not produce a handoff action', () => {
    const dir = setupWorkspace({
      'tasks.md':
        '## In progress\n\n- [~] **赵云** dispatch `12abcd34` — build feature ⊘ superseded\n',
    })
    const result = parseCockpit(dir)
    expect(result.aiActions.filter((a) => a.id.startsWith('handoff:'))).toEqual([])
  })
})
