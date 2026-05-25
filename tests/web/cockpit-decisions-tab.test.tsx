// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { ParsedDecisions } from '../../web/src/api.js'
import { DecisionsTab } from '../../web/src/cockpit/tabs/DecisionsTab.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const makeDecisions = (overrides: Partial<ParsedDecisions> = {}): ParsedDecisions => ({
  adopted: [],
  drafts: [],
  parseError: null,
  ...overrides,
})

describe('DecisionsTab', () => {
  test('opens confirmation dialog and posts decision confirmation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true }),
      ok: true,
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <DecisionsTab
        decisions={makeDecisions({
          drafts: [
            {
              date: '2026-05-24',
              filename: 'draft-2026-05-24-test-decision.md',
              raw: '# 决策：Test Decision',
              slug: 'test-decision',
              status: 'draft',
              title: 'Test Decision',
            },
          ],
        })}
        workspaceId="workspace-1"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Confirm archive' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getAllByText('Test Decision')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/cockpit/decisions/draft-2026-05-24-test-decision.md/confirm',
        expect.objectContaining({
          body: JSON.stringify({}),
          method: 'POST',
        })
      )
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  test('opens decision markdown in a browser tab', () => {
    const open = vi.fn()
    vi.stubGlobal('open', open)

    render(
      <DecisionsTab
        decisions={makeDecisions({
          adopted: [
            {
              date: '2026-05-24',
              filename: '2026-05-24-test-decision.md',
              raw: '# 决策：Test Decision',
              slug: 'test-decision',
              status: 'adopted',
              title: 'Test Decision',
            },
          ],
        })}
        workspaceId="workspace-1"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open document' }))

    expect(open).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/cockpit/doc-file?path=.hive%2Fdecisions%2F2026-05-24-test-decision.md',
      '_blank',
      'noopener,noreferrer'
    )
  })
})
