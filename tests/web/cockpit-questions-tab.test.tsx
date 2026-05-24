// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { ParsedQuestions } from '../../web/src/api.js'
import { QuestionsTab } from '../../web/src/cockpit/tabs/QuestionsTab.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const makeQuestions = (overrides: Partial<ParsedQuestions> = {}): ParsedQuestions => ({
  answered: [],
  high: [],
  low: [],
  medium: [],
  parseError: null,
  raw: '',
  ...overrides,
})

describe('QuestionsTab', () => {
  test('opens answer dialog and submits the answer to the workspace question endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true }),
      ok: true,
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <QuestionsTab
        questions={makeQuestions({
          high: [
            {
              id: 'Q3',
              priority: 'high',
              raw: '- [ ] **Q3** 是否开启 mobile voice spike',
              text: '是否开启 mobile voice spike',
            },
          ],
        })}
        workspaceId="workspace-1"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Answer' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getAllByText('是否开启 mobile voice spike')).toHaveLength(2)

    fireEvent.change(screen.getByPlaceholderText('Write the user answer here...'), {
      target: { value: '先做最小 spike' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/cockpit/questions/Q3/answer',
        expect.objectContaining({
          body: JSON.stringify({ answer: '先做最小 spike' }),
          method: 'POST',
        })
      )
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
