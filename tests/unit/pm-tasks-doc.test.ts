import { describe, expect, test } from 'vitest'

import { parseTasksDoc } from '../../src/server/pm-tasks-doc.js'

const FULL_TASKS = `## In progress

### 2026-05-20

- [x] Task A done
- [ ] Task B open

## Open

- [ ] Task C open

## Done

### 2026-05-15

- [x] Task D done
- [x] Task E done
`

const SINGLE_SECTION = `## In progress

- [ ] Task F
- [x] Task G
`

const SUBSECTION_TASKS = `## In progress

### 2026-05-20

- [x] Sub task A
- [ ] Sub task B

### 2026-05-19

- [x] Sub task C

## Done

- [x] Root task D
`

describe('parseTasksDoc', () => {
  test('parses all three sections with correct counts', () => {
    const result = parseTasksDoc(FULL_TASKS)
    expect(result.sections).toHaveLength(3)
    expect(result.totalDone).toBe(3)
    expect(result.totalOpen).toBe(2)
    expect(result.parseError).toBeNull()
  })

  test('maps section titles to keys', () => {
    const result = parseTasksDoc(FULL_TASKS)
    const keys = result.sections.map((s) => s.key)
    expect(keys).toEqual(['in_progress', 'open', 'done'])
  })

  test('parses subsection with date heading', () => {
    const result = parseTasksDoc(FULL_TASKS)
    const inProgress = result.sections[0]
    expect(inProgress).toBeDefined()
    expect(inProgress!.subsections).toHaveLength(1)
    expect(inProgress!.subsections[0]?.title).toBe('2026-05-20')
    expect(inProgress!.subsections[0]?.doneCount).toBe(1)
    expect(inProgress!.subsections[0]?.openCount).toBe(1)
    expect(inProgress!.subsections[0]?.totalCount).toBe(2)
  })

  test('single section works', () => {
    const result = parseTasksDoc(SINGLE_SECTION)
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0]?.key).toBe('in_progress')
    expect(result.sections[0]?.doneCount).toBe(1)
    expect(result.sections[0]?.openCount).toBe(1)
  })

  test('empty content returns empty sections', () => {
    const result = parseTasksDoc('')
    expect(result.sections).toEqual([])
    expect(result.totalDone).toBe(0)
    expect(result.totalOpen).toBe(0)
    expect(result.raw).toBe('')
  })

  test('missing section produces no entry for that section', () => {
    const content = '## Open\n\n- [ ] Only open task\n'
    const result = parseTasksDoc(content)
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0]?.key).toBe('open')
  })

  test('preserves section order as written (not alphabetical)', () => {
    const content = `## Done

- [x] Done first

## In progress

- [ ] In progress second

## Open

- [ ] Open third
`
    const result = parseTasksDoc(content)
    const keys = result.sections.map((s) => s.key)
    expect(keys).toEqual(['done', 'in_progress', 'open'])
  })

  test('subsection items count toward parent section totals', () => {
    const result = parseTasksDoc(SUBSECTION_TASKS)
    const inProgress = result.sections[0]
    expect(inProgress).toBeDefined()
    expect(inProgress!.doneCount).toBe(2)
    expect(inProgress!.openCount).toBe(1)
    expect(inProgress!.totalCount).toBe(3)
    expect(inProgress!.subsections).toHaveLength(2)
  })

  test('raw content is preserved', () => {
    const result = parseTasksDoc(FULL_TASKS)
    expect(result.raw).toBe(FULL_TASKS)
  })

  test('unknown section title maps to "other" key', () => {
    const content = '## Backlog\n\n- [ ] Some task\n'
    const result = parseTasksDoc(content)
    expect(result.sections[0]?.key).toBe('other')
  })

  test('checkbox outside section creates implicit Tasks section', () => {
    const content = '- [x] Orphan task\n'
    const result = parseTasksDoc(content)
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0]?.title).toBe('Tasks')
    expect(result.sections[0]?.doneCount).toBe(1)
  })

  test('task items contain raw, text, and done fields', () => {
    const result = parseTasksDoc('- [x] My task\n')
    const section = result.sections[0]
    expect(section).toBeDefined()
    const item = section!.items[0]
    expect(item).toBeDefined()
    expect(item!.done).toBe(true)
    expect(item!.text).toBe('My task')
    expect(item!.raw).toBe('- [x] My task')
  })
})
