// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'

import type { ParsedResearch } from '../../web/src/api.js'
import { ResearchTab } from '../../web/src/cockpit/tabs/ResearchTab.js'

afterEach(() => cleanup())

const localIso = (year: number, monthIndex: number, day: number, hour: number, minute: number) =>
  new Date(year, monthIndex, day, hour, minute).toISOString()

const makeResearch = (overrides: Partial<ParsedResearch> = {}): ParsedResearch => ({
  entries: [],
  parseError: null,
  totalCount: 0,
  ...overrides,
})

describe('ResearchTab', () => {
  test('renders empty state when no entries', () => {
    render(<ResearchTab research={makeResearch()} />)
    expect(screen.getByText(/No research notes/)).toBeInTheDocument()
  })

  test('renders total count in header', () => {
    render(
      <ResearchTab
        research={makeResearch({
          entries: [
            {
              date: '2026-05-20',
              filename: '2026-05-20-test.md',
              mtime: localIso(2026, 4, 24, 9, 30),
              size: 5,
              title: 'Test Research',
              topic: 'test',
            },
          ],
          totalCount: 1,
        })}
      />
    )
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  test('renders entry cards with date, title, filename, size, topic', () => {
    render(
      <ResearchTab
        research={makeResearch({
          entries: [
            {
              date: '2026-05-20',
              filename: '2026-05-20-api-design.md',
              mtime: localIso(2026, 4, 24, 9, 30),
              size: 12,
              title: 'API Design Notes',
              topic: 'api design',
            },
          ],
          totalCount: 1,
        })}
      />
    )
    expect(screen.getByText('2026-05-24 09:30')).toBeInTheDocument()
    expect(screen.queryByText('2026-05-20')).not.toBeInTheDocument()
    expect(screen.getByText('2026-05-20-api-design.md')).toBeInTheDocument()
    expect(screen.getByText('12 lines')).toBeInTheDocument()
    expect(screen.getByText('API Design Notes')).toBeInTheDocument()
    expect(screen.getByText('api design')).toBeInTheDocument()
  })

  test('renders multiple entries', () => {
    render(
      <ResearchTab
        research={makeResearch({
          entries: [
            {
              date: '2026-05-20',
              filename: 'a.md',
              mtime: localIso(2026, 4, 24, 10, 0),
              size: 1,
              title: 'First',
              topic: 'first',
            },
            {
              date: '2026-05-15',
              filename: 'b.md',
              mtime: localIso(2026, 4, 24, 9, 0),
              size: 2,
              title: 'Second',
              topic: 'second',
            },
          ],
          totalCount: 2,
        })}
      />
    )
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })

  test('renders parseError warning when present', () => {
    render(<ResearchTab research={makeResearch({ parseError: 'read error' })} />)
    expect(screen.getByText(/read error/)).toBeInTheDocument()
  })
})
