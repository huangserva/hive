// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { TimelineTab } from '../../web/src/cockpit/tabs/TimelineTab.js'

const dispatches = [
  {
    artifacts: [],
    created_at: 1_768_900_000_000,
    delivered_at: 1_768_900_001_000,
    from_agent_id: 'workspace-1:orchestrator',
    id: 'dispatch-1',
    reported_at: 1_768_900_610_000,
    report_text: 'Finished the API implementation and tests.',
    state: 'reported',
    submitted_at: 1_768_900_010_000,
    text: 'Implement timeline tab with statistics and filters',
    to_agent_id: 'worker-a',
    workspace_id: 'workspace-1',
  },
  {
    artifacts: [],
    created_at: 1_768_800_000_000,
    delivered_at: null,
    from_agent_id: 'workspace-1:orchestrator',
    id: 'dispatch-2',
    reported_at: null,
    report_text: null,
    state: 'submitted',
    submitted_at: 1_768_800_010_000,
    text: 'Investigate a long running task that should still be visible',
    to_agent_id: 'worker-b',
    workspace_id: 'workspace-1',
  },
  {
    artifacts: [],
    created_at: 1_768_700_000_000,
    delivered_at: null,
    from_agent_id: 'workspace-1:orchestrator',
    id: 'dispatch-3',
    reported_at: 1_768_700_020_000,
    report_text: 'cancelled by user',
    state: 'cancelled',
    submitted_at: 1_768_700_010_000,
    text: 'Cancel obsolete worker task',
    to_agent_id: 'worker-a',
    workspace_id: 'workspace-1',
  },
]

const workers = [
  {
    id: 'worker-a',
    name: '关羽',
    pendingTaskCount: 0,
    role: 'coder',
    status: 'idle',
  },
  {
    id: 'worker-b',
    name: '张飞',
    pendingTaskCount: 1,
    role: 'tester',
    status: 'working',
  },
]

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const stubTimelineFetch = () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/dispatches')) {
        return new Response(JSON.stringify(dispatches), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      }
      if (url.includes('/team')) {
        return new Response(
          JSON.stringify(
            workers.map((worker) => ({
              id: worker.id,
              name: worker.name,
              pending_task_count: worker.pendingTaskCount,
              role: worker.role,
              status: worker.status,
            }))
          ),
          { headers: { 'content-type': 'application/json' }, status: 200 }
        )
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
  )
}

describe('TimelineTab', () => {
  test('renders dispatch history, worker stats, and completion trend', async () => {
    stubTimelineFetch()
    render(<TimelineTab workspaceId="workspace-1" />)

    expect(await screen.findByText('Dispatch timeline')).toBeInTheDocument()
    expect(
      screen.getByText('Implement timeline tab with statistics and filters')
    ).toBeInTheDocument()
    expect(screen.getAllByText('关羽').length).toBeGreaterThan(0)
    expect(screen.getAllByText('张飞').length).toBeGreaterThan(0)
    expect(screen.getByText('2 dispatches')).toBeInTheDocument()
    expect(screen.getByText('1 reported')).toBeInTheDocument()
    expect(screen.getAllByText(/Average completion/).length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Dispatch trend')).toBeInTheDocument()
  })

  test('filters dispatches by worker and status', async () => {
    stubTimelineFetch()
    render(<TimelineTab workspaceId="workspace-1" />)

    await screen.findByText('Dispatch timeline')

    fireEvent.change(screen.getByLabelText('Filter by worker'), { target: { value: 'worker-b' } })
    expect(
      screen.getByText('Investigate a long running task that should still be visible')
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Implement timeline tab with statistics and filters')
    ).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'reported' } })
    await waitFor(() => {
      expect(screen.getByText('No dispatches match the current filters.')).toBeInTheDocument()
    })
  })

  test('expands a dispatch to show full task and report text', async () => {
    stubTimelineFetch()
    render(<TimelineTab workspaceId="workspace-1" />)

    await screen.findByText('Dispatch timeline')
    fireEvent.click(screen.getByRole('button', { name: /Implement timeline tab/ }))

    expect(screen.getByText('Full task')).toBeInTheDocument()
    expect(screen.getByText('Report')).toBeInTheDocument()
    expect(screen.getByText('Finished the API implementation and tests.')).toBeInTheDocument()
  })
})
