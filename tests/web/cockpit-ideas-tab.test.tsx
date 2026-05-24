// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { ParsedIdeas } from '../../web/src/api.js'
import { IdeasTab } from '../../web/src/cockpit/tabs/IdeasTab.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const makeIdeas = (overrides: Partial<ParsedIdeas> = {}): ParsedIdeas => ({
  inbox: [],
  parseError: null,
  promoted: [],
  raw: '',
  ...overrides,
})

describe('IdeasTab', () => {
  test('opens promote dialog and submits the selected target', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true }),
      ok: true,
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <IdeasTab
        ideas={makeIdeas({
          inbox: [
            {
              addedAt: '2026-05-24',
              id: 'I1',
              promoted: false,
              raw: '- 🤔 idea: add voice mode',
              text: 'add voice mode',
            },
          ],
        })}
        workspaceId="workspace-1"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Promote' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getAllByText('add voice mode')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/cockpit/ideas/I1/promote',
        expect.objectContaining({
          body: JSON.stringify({ target: 'question' }),
          method: 'POST',
        })
      )
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
