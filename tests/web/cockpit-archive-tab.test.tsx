// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'

import type { ParsedArchive } from '../../web/src/api.js'
import { ArchiveTab } from '../../web/src/cockpit/tabs/ArchiveTab.js'

afterEach(() => cleanup())

const makeArchive = (overrides: Partial<ParsedArchive> = {}): ParsedArchive => ({
  months: [],
  parseError: null,
  ...overrides,
})

describe('ArchiveTab', () => {
  test('renders empty state when no months', () => {
    render(<ArchiveTab archive={makeArchive()} />)
    expect(screen.getByText('No monthly archive folders yet.')).toBeInTheDocument()
  })

  test('renders months with file counts', () => {
    const archive = makeArchive({
      months: [
        { fileCount: 3, files: ['plan.md', 'tasks.md', 'questions.md'], month: '2026-05' },
        { fileCount: 1, files: ['plan.md'], month: '2026-04' },
      ],
    })
    render(<ArchiveTab archive={archive} />)
    expect(screen.getByText('2026-05')).toBeInTheDocument()
    expect(screen.getByText('2026-04')).toBeInTheDocument()
  })

  test('renders file names inside month details', () => {
    const archive = makeArchive({
      months: [{ fileCount: 2, files: ['plan.md', 'tasks.md'], month: '2026-05' }],
    })
    render(<ArchiveTab archive={archive} />)
    expect(screen.getByText('plan.md')).toBeInTheDocument()
    expect(screen.getByText('tasks.md')).toBeInTheDocument()
  })

  test('renders file count with i18n key', () => {
    const archive = makeArchive({
      months: [{ fileCount: 5, files: ['a.md', 'b.md', 'c.md', 'd.md', 'e.md'], month: '2026-03' }],
    })
    render(<ArchiveTab archive={archive} />)
    expect(screen.getByText('5 files')).toBeInTheDocument()
  })
})
