// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { ParsedBaseline } from '../../web/src/api.js'
import { BaselineTab } from '../../web/src/cockpit/tabs/BaselineTab.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const makeBaseline = (overrides: Partial<ParsedBaseline> = {}): ParsedBaseline => ({
  children: [],
  parseError: null,
  readme: null,
  staleHint: null,
  ...overrides,
})

describe('BaselineTab', () => {
  test('renders empty state when no readme', () => {
    render(<BaselineTab baseline={makeBaseline()} workspaceId="ws1" />)
    expect(screen.getByText('No baseline README found.')).toBeInTheDocument()
  })

  test('renders readme content when present', () => {
    const baseline = makeBaseline({
      readme: { raw: '# Baseline · My Project\n\nDescription.', title: 'Baseline · My Project' },
    })
    render(<BaselineTab baseline={baseline} workspaceId="ws1" />)
    expect(screen.getByText('Baseline · My Project')).toBeInTheDocument()
    expect(screen.getByText('Description.')).toBeInTheDocument()
  })

  test('renders staleHint warning when present', () => {
    const baseline = makeBaseline({ staleHint: '3 baseline files still need drafting' })
    render(<BaselineTab baseline={baseline} workspaceId="ws1" />)
    expect(screen.getByText('3 baseline files still need drafting')).toBeInTheDocument()
  })

  test('renders baseline file cards with metadata', () => {
    const baseline = makeBaseline({
      children: [
        {
          exists: true,
          filename: 'module-map.md',
          isStub: false,
          size: 42,
          staleReason: null,
          staleSince: null,
          title: 'Module Map',
        },
        {
          exists: true,
          filename: 'test-gates.md',
          isStub: true,
          size: 5,
          staleReason: 'still a stub',
          staleSince: 1000,
          title: 'Test Gates',
        },
      ],
    })
    render(<BaselineTab baseline={baseline} workspaceId="ws1" />)
    expect(screen.getByText('Module Map')).toBeInTheDocument()
    expect(screen.getByText('Test Gates')).toBeInTheDocument()
    expect(screen.getByText('stub')).toBeInTheDocument()
  })

  test('renders missing badge for non-existent files', () => {
    const baseline = makeBaseline({
      children: [
        {
          exists: false,
          filename: 'runtime-flows.md',
          isStub: false,
          size: 0,
          staleReason: null,
          staleSince: null,
          title: 'Runtime Flows',
        },
      ],
    })
    render(<BaselineTab baseline={baseline} workspaceId="ws1" />)
    expect(screen.getByText('missing')).toBeInTheDocument()
  })

  test('renders Baseline files section header', () => {
    render(<BaselineTab baseline={makeBaseline()} workspaceId="ws1" />)
    expect(screen.getByText('Baseline files')).toBeInTheDocument()
  })

  test('opens an existing baseline file in the embedded viewer', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '# Module Map\n\nServer modules.',
    })
    vi.stubGlobal('fetch', fetchMock)
    const baseline = makeBaseline({
      children: [
        {
          exists: true,
          filename: 'module-map.md',
          isStub: false,
          size: 42,
          staleReason: null,
          staleSince: null,
          title: 'Module Map',
        },
      ],
    })

    render(<BaselineTab baseline={baseline} workspaceId="ws1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open document' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/ws1/cockpit/doc-file?path=.hive%2Fbaseline%2Fmodule-map.md',
      expect.objectContaining({ credentials: 'include' })
    )
    expect(await screen.findByText(/Server modules/)).toBeInTheDocument()
  })
})
