// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { ParsedReports } from '../../web/src/api.js'
import { ReportsTab } from '../../web/src/cockpit/tabs/ReportsTab.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const localIso = (year: number, monthIndex: number, day: number, hour: number, minute: number) =>
  new Date(year, monthIndex, day, hour, minute).toISOString()

const makeReports = (overrides: Partial<ParsedReports> = {}): ParsedReports => ({
  entries: [],
  parseError: null,
  totalCount: 0,
  ...overrides,
})

describe('ReportsTab', () => {
  test('renders empty state when no entries', () => {
    render(<ReportsTab reports={makeReports()} workspaceId="ws1" />)
    expect(screen.getByText(/No reports/)).toBeInTheDocument()
  })

  test('renders report entries with mtime, filename, title, topic, and line count', () => {
    render(
      <ReportsTab
        reports={makeReports({
          entries: [
            {
              date: '2026-05-25',
              filename: '2026-05-25-cockpit-e2e.html',
              mtime: localIso(2026, 4, 25, 11, 20),
              path: '.hive/reports/2026-05-25-cockpit-e2e.html',
              size: 7,
              title: 'Cockpit E2E Report',
              topic: 'cockpit e2e',
            },
          ],
          totalCount: 1,
        })}
        workspaceId="ws1"
      />
    )

    expect(screen.getByText('2026-05-25 11:20')).toBeInTheDocument()
    expect(screen.getByText('2026-05-25-cockpit-e2e.html')).toBeInTheDocument()
    expect(screen.getByText('7 lines')).toBeInTheDocument()
    expect(screen.getByText('Cockpit E2E Report')).toBeInTheDocument()
    expect(screen.getByText('cockpit e2e')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open report' })).toBeInTheDocument()
  })

  test('Open button posts existing open-file request for the report path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <ReportsTab
        reports={makeReports({
          entries: [
            {
              date: '2026-05-25',
              filename: '2026-05-25-cockpit-e2e.html',
              mtime: localIso(2026, 4, 25, 11, 20),
              path: '.hive/reports/2026-05-25-cockpit-e2e.html',
              size: 7,
              title: 'Cockpit E2E Report',
              topic: 'cockpit e2e',
            },
          ],
          totalCount: 1,
        })}
        workspaceId="ws1"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open report' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/ws1/open-file',
        expect.objectContaining({
          body: JSON.stringify({ path: '.hive/reports/2026-05-25-cockpit-e2e.html' }),
          method: 'POST',
        })
      )
    })
  })
})
