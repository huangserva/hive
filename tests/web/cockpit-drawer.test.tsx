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
  research: { entries: [], parseError: null, totalCount: 0 },
  tasks: { parseError: null, raw: '', sections: [], totalDone: 0, totalOpen: 0 },
  ...overrides,
})

describe('CockpitDrawer', () => {
  test('open drawer does not emit Radix missing description warnings', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
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
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Missing `Description`'))
    } finally {
      errorSpy.mockRestore()
    }
  })

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

  test('tab body container has overflow-y-auto class', () => {
    render(
      <CockpitDrawer
        cockpit={makeCockpit()}
        error={null}
        isConnected={true}
        onClose={vi.fn()}
        open={true}
        workspacePath={null}
      />
    )
    const drawer = screen.getByTestId('cockpit-drawer')
    const scrollDiv = drawer.querySelector('[class*="overflow-y-auto"]')
    expect(scrollDiv).toBeTruthy()
  })

  test('ActionBar remains in DOM alongside scrollable content', () => {
    const cockpit = makeCockpit({
      aiActions: [
        {
          action: '回答',
          id: 'q-1',
          priority: 'high',
          targetTab: 'questions',
          text: 'Action present',
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
    const drawer = screen.getByTestId('cockpit-drawer')
    expect(drawer.querySelector('[class*="overflow-y-auto"]')).toBeTruthy()
    expect(screen.getByText('Action present')).toBeInTheDocument()
  })
})
