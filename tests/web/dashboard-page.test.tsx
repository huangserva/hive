// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { DashboardWorkspace } from '../../web/src/api.js'
import { DashboardPage } from '../../web/src/dashboard/DashboardPage.js'

const mockWorkspaces: DashboardWorkspace[] = [
  {
    id: 'ws-1',
    name: 'Project Alpha',
    cwd: '/home/user/alpha',
    workerCount: 4,
    activeWorkerCount: 2,
    recentDispatchCount: 7,
    openDispatchCount: 1,
    lastActivityAt: Date.now() - 300_000,
  },
  {
    id: 'ws-2',
    name: 'Project Beta',
    cwd: '/home/user/beta',
    workerCount: 2,
    activeWorkerCount: 0,
    recentDispatchCount: 0,
    openDispatchCount: 0,
    lastActivityAt: null,
  },
]

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DashboardPage', () => {
  test('renders workspace cards from API', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(mockWorkspaces) })
    render(<DashboardPage onSelectWorkspace={() => {}} />)
    await waitFor(() => {
      expect(screen.getAllByTestId('dashboard-card')).toHaveLength(2)
    })
    expect(screen.getByText('Project Alpha')).toBeInTheDocument()
    expect(screen.getByText('Project Beta')).toBeInTheDocument()
  })

  test('shows empty state when no workspaces', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    render(<DashboardPage onSelectWorkspace={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText(/no workspaces/i)).toBeInTheDocument()
    })
  })

  test('clicking a card calls onSelectWorkspace', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(mockWorkspaces) })
    const onSelect = vi.fn()
    render(<DashboardPage onSelectWorkspace={onSelect} />)
    await waitFor(() => {
      expect(screen.getAllByTestId('dashboard-card')).toHaveLength(2)
    })
    fireEvent.click(screen.getByText('Project Alpha'))
    expect(onSelect).toHaveBeenCalledWith('ws-1')
  })

  test('shows open dispatch count with highlight', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve(mockWorkspaces) })
    render(<DashboardPage onSelectWorkspace={() => {}} />)
    await waitFor(() => {
      expect(screen.getAllByTestId('dashboard-card')).toHaveLength(2)
    })
    const cards = screen.getAllByTestId('dashboard-card')
    expect(cards[0]).toHaveTextContent('Open')
    expect(cards[1]).not.toHaveTextContent('Open')
  })
})
