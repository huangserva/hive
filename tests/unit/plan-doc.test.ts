import { describe, expect, test } from 'vitest'

import { parsePlanDoc } from '../../src/server/plan-doc.js'

const FULL_PLAN = `---
title: HippoTeam Project
started: "2026-05-01"
current_phase: M1
status: active
last_review: "2026-05-20"
---

## 目标

Ship a stable Hive system with e2e Feishu integration.

## 里程碑

### M1 · 稳定性强化 · shipped 2026-05-20

- [x] Fix uncaught exception audit
- [x] Add schema version tracking
- [ ] Refactor agent manager

### M7 · 真飞书 e2e · blocked

- [ ] Wire approval cards
- [ ] End-to-end smoke test

### M8 · PM tooling · proposed

- [X] Auto-generate PROTOCOL.md

### M10 · Scale testing · open

- [ ] Load test with 50 agents

### M99 · 默认状态测试

- [ ] Some unchecked item
- [x] A checked item

## Scope

- in: Core Hive runtime
- in: Feishu outbound bridge
- out: Slack integration
- out: Multi-tenant auth

## 已知 risk

- PTY process leak on crash
- SQLite lock contention under concurrency

## 当前 phase

M1 — stabilizing core runtime and test coverage.`

describe('parsePlanDoc — frontmatter', () => {
  test('parses all frontmatter fields', () => {
    const plan = parsePlanDoc(FULL_PLAN)
    expect(plan.frontmatter.title).toBe('HippoTeam Project')
    expect(plan.frontmatter.started).toBe('2026-05-01')
    expect(plan.frontmatter.current_phase).toBe('M1')
    expect(plan.frontmatter.status).toBe('active')
    expect(plan.frontmatter.last_review).toBe('2026-05-20')
    expect(plan.parseError).toBeNull()
  })

  test('empty frontmatter when no --- delimiters', () => {
    const content = '## 目标\n\nSome goal text.'
    const plan = parsePlanDoc(content)
    expect(plan.frontmatter).toEqual({})
    expect(plan.parseError).toBeNull()
  })

  test('strips quotes from frontmatter values', () => {
    const plan = parsePlanDoc('---\ntitle: "HippoTeam Project"\n---\n')
    expect(plan.frontmatter.title).toBe('HippoTeam Project')
  })

  test('preserves colons inside quoted frontmatter values', () => {
    const plan = parsePlanDoc('---\ndescription: "a:b:c"\n---\n')
    expect(plan.frontmatter.description).toBe('a:b:c')
  })

  test('malformed frontmatter without trailing --- falls back gracefully', () => {
    const plan = parsePlanDoc('---\ntitle: Broken\n\n## 目标\n\nGoal text.')
    expect(plan.frontmatter).toEqual({})
    expect(plan.raw).toContain('title: Broken')
    expect(plan.parseError).toBeNull()
  })
})

describe('parsePlanDoc — milestone heading recognition', () => {
  test('parses shipped milestone with date', () => {
    const plan = parsePlanDoc(FULL_PLAN)
    const m1 = plan.milestones.find((m) => m.id === 'M1')
    expect(m1).toBeDefined()
    expect(m1?.status).toBe('shipped')
    expect(m1?.date).toBe('2026-05-20')
    expect(m1?.title).toBe('稳定性强化')
  })

  test('parses blocked milestone without date', () => {
    const plan = parsePlanDoc(FULL_PLAN)
    const m7 = plan.milestones.find((m) => m.id === 'M7')
    expect(m7).toBeDefined()
    expect(m7?.status).toBe('blocked')
    expect(m7?.date).toBeUndefined()
  })

  test('parses proposed milestone', () => {
    const plan = parsePlanDoc(FULL_PLAN)
    const m8 = plan.milestones.find((m) => m.id === 'M8')
    expect(m8).toBeDefined()
    expect(m8?.status).toBe('proposed')
  })

  test('parses open milestone', () => {
    const plan = parsePlanDoc(FULL_PLAN)
    const m10 = plan.milestones.find((m) => m.id === 'M10')
    expect(m10).toBeDefined()
    expect(m10?.status).toBe('open')
  })

  test('defaults to in_progress when no status keyword', () => {
    const plan = parsePlanDoc(FULL_PLAN)
    const m99 = plan.milestones.find((m) => m.id === 'M99')
    expect(m99).toBeDefined()
    expect(m99?.status).toBe('in_progress')
  })

  test('skips heading without M\\d+ pattern — uses first word as id', () => {
    const content = '## 里程碑\n\n### Custom · shipped\n\n- [x] Done item'
    const plan = parsePlanDoc(content)
    expect(plan.milestones).toHaveLength(1)
    expect(plan.milestones[0]?.id).toBe('Custom')
    expect(plan.milestones[0]?.status).toBe('shipped')
  })
})

describe('parsePlanDoc — checkbox statistics', () => {
  test('all checked items → progress=1.0', () => {
    const content = '## 里程碑\n\n### M1 · shipped\n\n- [x] Item A\n- [x] Item B'
    const plan = parsePlanDoc(content)
    expect(plan.milestones[0]?.doneCount).toBe(2)
    expect(plan.milestones[0]?.totalCount).toBe(2)
    expect(plan.milestones[0]?.progress).toBe(1)
  })

  test('all unchecked items → progress=0', () => {
    const content = '## 里程碑\n\n### M1 · shipped\n\n- [ ] A\n- [ ] B'
    const plan = parsePlanDoc(content)
    expect(plan.milestones[0]?.doneCount).toBe(0)
    expect(plan.milestones[0]?.progress).toBe(0)
  })

  test('mixed checked/unchecked with case-insensitive [X]', () => {
    const content = '## 里程碑\n\n### M1\n\n- [x] Done\n- [X] Also done\n- [ ] Not done'
    const plan = parsePlanDoc(content)
    const m = plan.milestones[0]
    expect(m?.doneCount).toBe(2)
    expect(m?.totalCount).toBe(3)
    expect(m?.progress).toBeCloseTo(2 / 3)
  })

  test('zero items → progress=0 not NaN', () => {
    const content = '## 里程碑\n\n### M1 · shipped\n\nNo checkboxes here.'
    const plan = parsePlanDoc(content)
    expect(plan.milestones[0]?.doneCount).toBe(0)
    expect(plan.milestones[0]?.totalCount).toBe(0)
    expect(plan.milestones[0]?.progress).toBe(0)
  })

  test('indented checkboxes are counted', () => {
    const content = '## 里程碑\n\n### M1\n\n - [x] Indented done\n  - [ ] Deep unchecked'
    const plan = parsePlanDoc(content)
    expect(plan.milestones[0]?.totalCount).toBe(2)
    expect(plan.milestones[0]?.doneCount).toBe(1)
  })
})

describe('parsePlanDoc — scope section', () => {
  test('parses in/out scope lines', () => {
    const plan = parsePlanDoc(FULL_PLAN)
    expect(plan.scope).toEqual({
      in: ['Core Hive runtime', 'Feishu outbound bridge'],
      out: ['Slack integration', 'Multi-tenant auth'],
    })
  })

  test('parses scope with bullet list under in:/out: labels', () => {
    const content = [
      '## Scope',
      '',
      '- in:',
      '  - Runtime',
      '  - CLI',
      '- out:',
      '  - Web UI',
    ].join('\n')
    const plan = parsePlanDoc(content)
    expect(plan.scope).toEqual({
      in: ['Runtime', 'CLI'],
      out: ['Web UI'],
    })
  })

  test('returns null when no Scope section', () => {
    const plan = parsePlanDoc('## 目标\n\nA goal.\n')
    expect(plan.scope).toBeNull()
  })
})

describe('parsePlanDoc — risk section', () => {
  test('parses bullet-form risks', () => {
    const plan = parsePlanDoc(FULL_PLAN)
    expect(plan.risks).toEqual([
      'PTY process leak on crash',
      'SQLite lock contention under concurrency',
    ])
  })

  test('parses table-row risks', () => {
    const content = [
      '## Risks',
      '',
      '| risk | impact | mitigation |',
      '|------|--------|------------|',
      '| Data loss | High | Backup |',
      '| Timeout | Medium | Retry |',
    ].join('\n')
    const plan = parsePlanDoc(content)
    expect(plan.risks).toEqual(['Data loss · High · Backup', 'Timeout · Medium · Retry'])
  })

  test('returns empty array when no Risk section', () => {
    const plan = parsePlanDoc('## 目标\n\nA goal.\n')
    expect(plan.risks).toEqual([])
  })
})

describe('parsePlanDoc — goal and currentPhase', () => {
  test('parses goal section (Chinese heading)', () => {
    const plan = parsePlanDoc(FULL_PLAN)
    expect(plan.goal).toBe('Ship a stable Hive system with e2e Feishu integration.')
  })

  test('parses goal section (English heading)', () => {
    const plan = parsePlanDoc('## Goal\n\nDeliver v1.\n')
    expect(plan.goal).toBe('Deliver v1.')
  })

  test('parses currentPhase section', () => {
    const plan = parsePlanDoc(FULL_PLAN)
    expect(plan.currentPhase).toBe('M1 — stabilizing core runtime and test coverage.')
  })

  test('goal null when section absent', () => {
    const plan = parsePlanDoc('## Something else\n\nText.\n')
    expect(plan.goal).toBeNull()
  })
})

describe('parsePlanDoc — fallback / error handling', () => {
  test('completely corrupted content returns parseError=null with raw preserved', () => {
    const content = '{{{{not markdown at all}}}}'
    const plan = parsePlanDoc(content)
    expect(plan.raw).toBe(content)
    expect(plan.milestones).toEqual([])
    expect(plan.parseError).toBeNull()
  })

  test('raw always contains the original input', () => {
    const plan = parsePlanDoc(FULL_PLAN)
    expect(plan.raw).toBe(FULL_PLAN)
  })

  test('milestone items carry text and done fields correctly', () => {
    const plan = parsePlanDoc(FULL_PLAN)
    const m1 = plan.milestones.find((m) => m.id === 'M1')
    expect(m1).toBeDefined()
    expect(m1?.items).toEqual([
      { done: true, text: 'Fix uncaught exception audit' },
      { done: true, text: 'Add schema version tracking' },
      { done: false, text: 'Refactor agent manager' },
    ])
  })
})
