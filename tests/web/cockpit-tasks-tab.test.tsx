// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'

import type { ParsedTasks } from '../../web/src/api.js'
import { TasksTab } from '../../web/src/cockpit/tabs/TasksTab.js'

afterEach(() => cleanup())

const makeTasks = (overrides: Partial<ParsedTasks> = {}): ParsedTasks => ({
  parseError: null,
  raw: '',
  sections: [],
  totalDone: 0,
  totalOpen: 0,
  ...overrides,
})

const makeSection = (overrides: Partial<ParsedTasks['sections'][0]> = {}) => ({
  doneCount: 0,
  key: 'in_progress' as const,
  openCount: 0,
  subsections: [],
  title: 'In progress',
  totalCount: 0,
  items: [],
  ...overrides,
})

describe('TasksTab', () => {
  test('renders empty state when no sections', () => {
    render(<TasksTab tasks={makeTasks()} />)
    expect(screen.getByText(/No task sections parsed/)).toBeInTheDocument()
  })

  test('renders overall progress N/M in header', () => {
    render(<TasksTab tasks={makeTasks({ totalDone: 3, totalOpen: 2 })} />)
    expect(screen.getByText('3/5')).toBeInTheDocument()
  })

  test('renders section titles and per-section stats', () => {
    const tasks = makeTasks({
      sections: [
        makeSection({
          title: 'In progress',
          key: 'in_progress',
          doneCount: 1,
          openCount: 2,
          totalCount: 3,
          items: [
            { done: true, raw: '- [x] Done task', text: 'Done task' },
            { done: false, raw: '- [ ] Open task 1', text: 'Open task 1' },
            { done: false, raw: '- [ ] Open task 2', text: 'Open task 2' },
          ],
        }),
      ],
      totalDone: 1,
      totalOpen: 2,
    })
    render(<TasksTab tasks={tasks} />)
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText('2 open · 1 done')).toBeInTheDocument()
  })

  test('renders task items with checkbox states', () => {
    const tasks = makeTasks({
      sections: [
        makeSection({
          items: [
            { done: true, raw: '- [x] Done', text: 'Done' },
            { done: false, raw: '- [ ] Open', text: 'Open' },
          ],
          doneCount: 1,
          openCount: 1,
          totalCount: 2,
        }),
      ],
      totalDone: 1,
      totalOpen: 1,
    })
    render(<TasksTab tasks={tasks} />)
    expect(screen.getByText('[x]')).toBeInTheDocument()
    expect(screen.getByText('[ ]')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('Open')).toBeInTheDocument()
  })

  test('renders subsection blocks with done/total counts', () => {
    const tasks = makeTasks({
      sections: [
        makeSection({
          subsections: [
            {
              doneCount: 1,
              items: [{ done: true, raw: '- [x] Sub', text: 'Sub' }],
              openCount: 0,
              title: '2026-05-20',
              totalCount: 1,
            },
          ],
          doneCount: 1,
          openCount: 0,
          totalCount: 1,
        }),
      ],
      totalDone: 1,
      totalOpen: 0,
    })
    render(<TasksTab tasks={tasks} />)
    expect(screen.getByText('2026-05-20')).toBeInTheDocument()
    const subsectionCounts = screen.getAllByText('1/1')
    expect(subsectionCounts.length).toBeGreaterThanOrEqual(1)
  })

  test('renders parseError warning when present', () => {
    render(<TasksTab tasks={makeTasks({ parseError: 'bad markdown' })} />)
    expect(screen.getByText(/bad markdown/)).toBeInTheDocument()
  })

  test('renders progress bar with correct aria-valuenow', () => {
    const tasks = makeTasks({
      sections: [
        makeSection({
          doneCount: 2,
          openCount: 2,
          totalCount: 4,
        }),
      ],
      totalDone: 2,
      totalOpen: 2,
    })
    render(<TasksTab tasks={tasks} />)
    const bars = screen.getAllByRole('progressbar')
    expect(bars.length).toBeGreaterThanOrEqual(1)
    expect(bars[0]).toHaveAttribute('aria-valuenow', '50')
  })
})
