import { describe, expect, test } from 'vitest'

import { normalizeCockpit, normalizePlan } from '../../web/src/cockpit/cockpit-normalize.js'

describe('normalizeCockpit', () => {
  test('a totally empty / undefined payload yields safe empty containers (no render-time throw)', () => {
    const cockpit = normalizeCockpit(undefined)
    // Exactly the deep accesses the render layer makes (CockpitTabs.tsx:55-61).
    expect(cockpit.questions.high.length).toBe(0)
    expect(cockpit.questions.medium.length).toBe(0)
    expect(cockpit.ideas.inbox.length).toBe(0)
    expect(cockpit.decisions.drafts.length).toBe(0)
    expect(cockpit.decisions.adopted.length).toBe(0)
    expect(cockpit.archive.months.length).toBe(0)
    expect(cockpit.research.totalCount).toBe(0)
    expect(cockpit.reports.totalCount).toBe(0)
    expect(cockpit.baseline.staleHint).toBeNull()
    expect(cockpit.tasks.totalOpen).toBe(0)
    expect(cockpit.tasks.totalDone).toBe(0)
    expect(cockpit.aiActions).toEqual([])
    expect(cockpit.plan.milestones).toEqual([])
  })

  test('a partial payload (only questions, missing everything else) still fills the rest', () => {
    const cockpit = normalizeCockpit({ questions: { high: [{ id: 'q1' }] } })
    expect(cockpit.questions.high).toEqual([{ id: 'q1' }])
    expect(cockpit.questions.medium).toEqual([])
    // Missing containers must not be undefined.
    expect(cockpit.ideas.inbox).toEqual([])
    expect(cockpit.archive.months).toEqual([])
  })

  test('wrong-typed fields are coerced to safe defaults, never passed through raw', () => {
    const cockpit = normalizeCockpit({
      aiActions: 'not-an-array',
      generatedAt: 'nope',
      questions: { high: 'not-an-array' },
      research: { totalCount: 'five' },
    })
    expect(cockpit.aiActions).toEqual([])
    expect(cockpit.generatedAt).toBe(0)
    expect(cockpit.questions.high).toEqual([])
    expect(cockpit.research.totalCount).toBe(0)
  })

  test('a well-formed payload is preserved field-for-field', () => {
    const cockpit = normalizeCockpit({
      aiActions: [{ id: 'a1' }],
      archive: { months: [{ month: '2026-06' }], parseError: null },
      baseline: { children: [], parseError: null, readme: null, staleHint: 'stale' },
      decisions: { adopted: [], drafts: [{ id: 'd1' }], parseError: null },
      generatedAt: 123,
      ideas: { inbox: [{ id: 'i1' }], parseError: null, promoted: [], raw: 'x' },
      plan: { milestones: [{ id: 'm1' }], raw: 'plan', risks: ['r1'] },
      questions: {
        answered: [],
        high: [{ id: 'q1' }],
        low: [],
        medium: [],
        parseError: null,
        raw: '',
      },
      reports: { entries: [], parseError: null, totalCount: 2 },
      research: { entries: [], parseError: null, totalCount: 3 },
      tasks: { parseError: null, raw: '', sections: [], totalDone: 4, totalOpen: 5 },
    })
    expect(cockpit.generatedAt).toBe(123)
    expect(cockpit.baseline.staleHint).toBe('stale')
    expect(cockpit.decisions.drafts).toEqual([{ id: 'd1' }])
    expect(cockpit.tasks.totalDone).toBe(4)
    expect(cockpit.tasks.totalOpen).toBe(5)
    expect(cockpit.plan.milestones).toEqual([{ id: 'm1' }])
    expect(cockpit.plan.risks).toEqual(['r1'])
  })
})

describe('normalizePlan', () => {
  test('empty payload yields safe defaults', () => {
    const plan = normalizePlan(null)
    expect(plan.milestones).toEqual([])
    expect(plan.risks).toEqual([])
    expect(plan.scope).toBeNull()
    expect(plan.currentPhase).toBeNull()
    expect(plan.raw).toBe('')
  })

  test('scope is null unless it is an object with in/out arrays', () => {
    expect(normalizePlan({ scope: 'bad' }).scope).toBeNull()
    expect(normalizePlan({ scope: { in: ['a'], out: ['b', 2] } }).scope).toEqual({
      in: ['a'],
      out: ['b'],
    })
  })

  test('non-string risks entries are filtered out', () => {
    expect(normalizePlan({ risks: ['ok', 5, null, 'fine'] }).risks).toEqual(['ok', 'fine'])
  })
})

describe('normalizeCockpit nested element defaults (Blocking 3 — deep render access)', () => {
  test('archive month missing files → files=[] (ArchiveTab month.files.map must not throw)', () => {
    const cockpit = normalizeCockpit({ archive: { months: [{ month: '2026-06' }] } })
    const month = cockpit.archive.months[0]
    expect(month).toBeDefined()
    expect(month?.files).toEqual([])
    expect(month?.fileCount).toBe(0)
    expect(month?.month).toBe('2026-06')
    expect(() => month?.files.map((file) => file)).not.toThrow()
  })

  test('tasks section missing items/subsections → safe arrays (TasksTab must not throw)', () => {
    const cockpit = normalizeCockpit({ tasks: { sections: [{}] } })
    const section = cockpit.tasks.sections[0]
    expect(section).toBeDefined()
    expect(section?.items).toEqual([])
    expect(section?.subsections).toEqual([])
    expect(() => section?.items.length).not.toThrow()
    expect(() => section?.subsections.map((sub) => sub)).not.toThrow()
  })

  test('tasks subsection missing items → items=[] (SubsectionBlock must not throw)', () => {
    const cockpit = normalizeCockpit({
      tasks: { sections: [{ subsections: [{ title: 'Sub' }] }] },
    })
    const subsection = cockpit.tasks.sections[0]?.subsections[0]
    expect(subsection).toBeDefined()
    expect(subsection?.items).toEqual([])
    expect(subsection?.title).toBe('Sub')
  })

  test('task item fields are coerced (done→boolean, text/raw→string)', () => {
    const cockpit = normalizeCockpit({
      tasks: { sections: [{ items: [{ done: 'yes', text: 42 }] }] },
    })
    const item = cockpit.tasks.sections[0]?.items[0]
    expect(item).toBeDefined()
    expect(item?.done).toBe(false) // only literal true is truthy
    expect(item?.text).toBe('')
    expect(item?.raw).toBe('')
  })

  test('well-formed nested task/archive payloads are preserved', () => {
    const cockpit = normalizeCockpit({
      archive: { months: [{ fileCount: 2, files: ['a.md', 'b.md'], month: '2026-06' }] },
      tasks: {
        sections: [
          {
            doneCount: 1,
            items: [{ done: true, raw: '- [x] done', text: 'done' }],
            key: 'in_progress',
            openCount: 0,
            subsections: [{ items: [{ done: false, raw: '- [ ] x', text: 'x' }], title: 'Sub' }],
            title: 'Sprint',
            totalCount: 1,
          },
        ],
      },
    })
    expect(cockpit.archive.months[0]?.files).toEqual(['a.md', 'b.md'])
    expect(cockpit.tasks.sections[0]?.items[0]?.done).toBe(true)
    expect(cockpit.tasks.sections[0]?.subsections[0]?.items[0]?.text).toBe('x')
  })
})
