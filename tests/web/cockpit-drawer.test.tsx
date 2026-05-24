// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { ParsedCockpit } from '../../web/src/api.js'
import { CockpitDrawer } from '../../web/src/cockpit/CockpitDrawer.js'

afterEach(() => cleanup())

const makeCockpit = (overrides: Partial<ParsedCockpit> = {}): ParsedCockpit => ({
  aiActions: [],
  archive: { months: [], parseError: null },
  baseline: { children: [], parseError: null, readme: null },
  decisions: { adopted: [], drafts: [], parseError: null },
  generatedAt: Date.now(),
  ideas: { inbox: [], parseError: null, promoted: [] },
  plan: {
    currentPhase: null,
    frontmatter: {},
    goal: null,
    milestones: [],
    parseError: null,
    raw: '',
    risks: [],
    scope: null,
  },
  questions: { answered: [], high: [], low: [], medium: [], parseError: null },
  ...overrides,
})

describe('CockpitDrawer', () => {
  test('closed — drawer not in document when open=false', () => {
    render(
      <CockpitDrawer
        cockpit={null}
        error={null}
        isConnected={false}
        onClose={vi.fn()}
        open={false}
        workspacePath={null}
      />
    )
    expect(screen.queryByTestId('cockpit-drawer')).not.toBeInTheDocument()
  })

  test('open with no cockpit shows loading state', () => {
    render(
      <CockpitDrawer
        cockpit={null}
        error={null}
        isConnected={false}
        onClose={vi.fn()}
        open={true}
        workspacePath={null}
      />
    )
    expect(screen.getByTestId('cockpit-drawer')).toBeInTheDocument()
    expect(screen.getByText('Loading cockpit')).toBeInTheDocument()
  })

  test('open with error shows error message', () => {
    render(
      <CockpitDrawer
        cockpit={null}
        error="Something broke"
        isConnected={true}
        onClose={vi.fn()}
        open={true}
        workspacePath={null}
      />
    )
    expect(screen.getByText('Something broke')).toBeInTheDocument()
  })

  test('open with cockpit shows live badge', () => {
    render(
      <CockpitDrawer
        cockpit={makeCockpit()}
        error={null}
        isConnected={true}
        onClose={vi.fn()}
        open={true}
        workspacePath="/tmp/ws"
      />
    )
    expect(screen.getByText('live')).toBeInTheDocument()
  })

  test('disconnected shows loading badge', () => {
    render(
      <CockpitDrawer
        cockpit={makeCockpit()}
        error={null}
        isConnected={false}
        onClose={vi.fn()}
        open={true}
        workspacePath={null}
      />
    )
    expect(screen.getByText('loading')).toBeInTheDocument()
  })

  test('close button triggers onClose', () => {
    const onClose = vi.fn()
    render(
      <CockpitDrawer
        cockpit={makeCockpit()}
        error={null}
        isConnected={true}
        onClose={onClose}
        open={true}
        workspacePath={null}
      />
    )
    screen.getByRole('button', { name: 'Close Cockpit' }).click()
    expect(onClose).toHaveBeenCalledOnce()
  })

  test('renders ActionBar with aiActions from cockpit', () => {
    const cockpit = makeCockpit({
      aiActions: [
        {
          action: '回答',
          id: 'q-1',
          priority: 'high',
          targetTab: 'questions',
          text: 'Answer Q1',
          type: 'question',
        },
      ],
    })
    render(
      <CockpitDrawer
        cockpit={cockpit}
        error={null}
        isConnected={true}
        onClose={vi.fn()}
        open={true}
        workspacePath={null}
      />
    )
    expect(screen.getByText('Answer Q1')).toBeInTheDocument()
    expect(screen.getByText('(1)')).toBeInTheDocument()
  })
})
