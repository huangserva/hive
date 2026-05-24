// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { ParsedPlan } from '../../web/src/api.js'
import { PlanDrawer } from '../../web/src/plan/PlanDrawer.js'

afterEach(() => cleanup())

const makePlan = (overrides: Partial<ParsedPlan> = {}): ParsedPlan => ({
  currentPhase: null,
  frontmatter: {},
  goal: null,
  milestones: [],
  parseError: null,
  raw: '',
  risks: [],
  scope: null,
  ...overrides,
})

const FULL_PLAN: ParsedPlan = makePlan({
  currentPhase: 'M1 — stabilizing',
  frontmatter: { status: 'active', title: 'Test Project' },
  goal: 'Ship the product.',
  milestones: [
    {
      body: '',
      date: '2026-05-20',
      doneCount: 2,
      id: 'M1',
      items: [
        { done: true, text: 'Task A' },
        { done: true, text: 'Task B' },
      ],
      progress: 1,
      status: 'shipped',
      title: 'Stability',
      totalCount: 2,
    },
    {
      body: '',
      doneCount: 0,
      id: 'M2',
      items: [
        { done: false, text: 'Task C' },
        { done: false, text: 'Task D' },
        { done: false, text: 'Task E' },
      ],
      progress: 0,
      status: 'in_progress',
      title: 'Feishu',
      totalCount: 3,
    },
    {
      body: '',
      doneCount: 1,
      id: 'M3',
      items: [
        { done: true, text: 'Task F' },
        { done: false, text: 'Task G' },
      ],
      progress: 0.5,
      status: 'blocked',
      title: 'Scale',
      totalCount: 2,
    },
  ],
  raw: '## raw content',
  risks: ['Risk A', 'Risk B'],
  scope: { in: ['Core'], out: ['Extras'] },
})

describe('PlanDrawer', () => {
  test('closed by default — aria-hidden=true, close button visible', () => {
    render(
      <PlanDrawer loaded={true} onClose={vi.fn()} open={false} plan={null} workspacePath={null} />
    )
    const drawer = screen.getByTestId('plan-drawer')
    expect(drawer.getAttribute('aria-hidden')).toBe('true')
    expect(drawer.classList.contains('open')).toBe(false)
  })

  test('open state shows header with Plan label and close button', () => {
    const onClose = vi.fn()
    render(
      <PlanDrawer
        loaded={true}
        onClose={onClose}
        open={true}
        plan={FULL_PLAN}
        workspacePath="/tmp/ws"
      />
    )
    const drawer = screen.getByTestId('plan-drawer')
    expect(drawer.getAttribute('aria-hidden')).toBe('false')
    expect(drawer.classList.contains('open')).toBe(true)
    expect(screen.getByText('Plan')).toBeInTheDocument()

    const closeBtn = screen.getByLabelText('Close Plan')
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('loading state shows "Loading plan..."', () => {
    render(
      <PlanDrawer loaded={false} onClose={vi.fn()} open={true} plan={null} workspacePath={null} />
    )
    expect(screen.getByText('Loading plan...')).toBeInTheDocument()
  })

  test('loaded with null plan shows empty state', () => {
    render(
      <PlanDrawer loaded={true} onClose={vi.fn()} open={true} plan={null} workspacePath={null} />
    )
    expect(screen.getByTestId('empty-state-title')).toHaveTextContent('No plan loaded')
  })

  test('progress bar shows correct done/total and percentage', () => {
    render(
      <PlanDrawer
        loaded={true}
        onClose={vi.fn()}
        open={true}
        plan={FULL_PLAN}
        workspacePath={null}
      />
    )
    expect(screen.getByText('43%')).toBeInTheDocument()
    expect(screen.getByText('3/7')).toBeInTheDocument()
    const progressbar = screen.getByRole('progressbar')
    expect(progressbar.getAttribute('aria-valuenow')).toBe('43')
  })

  test('milestones grouped by status in order: shipped, in_progress, blocked', () => {
    render(
      <PlanDrawer
        loaded={true}
        onClose={vi.fn()}
        open={true}
        plan={FULL_PLAN}
        workspacePath={null}
      />
    )
    const groupHeadings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(groupHeadings).toContain('Shipped')
    expect(groupHeadings).toContain('In progress')
    expect(groupHeadings).toContain('Blocked')
    const shippedIdx = groupHeadings.indexOf('Shipped')
    const inProgressIdx = groupHeadings.indexOf('In progress')
    const blockedIdx = groupHeadings.indexOf('Blocked')
    expect(shippedIdx).toBeLessThan(inProgressIdx)
    expect(inProgressIdx).toBeLessThan(blockedIdx)
  })

  test('parseError shows warning banner and raw markdown in pre block', () => {
    const plan = makePlan({ parseError: 'Unexpected token', raw: '## broken\n\nbad content' })
    render(
      <PlanDrawer loaded={true} onClose={vi.fn()} open={true} plan={plan} workspacePath={null} />
    )
    expect(screen.getByText(/plan.md parse warning/)).toHaveTextContent(
      'plan.md parse warning: Unexpected token'
    )
    const pre = document.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre?.textContent).toContain('## broken')
  })

  test('risks rendered in risk list', () => {
    render(
      <PlanDrawer
        loaded={true}
        onClose={vi.fn()}
        open={true}
        plan={FULL_PLAN}
        workspacePath={null}
      />
    )
    expect(screen.getByText('Risk A')).toBeInTheDocument()
    expect(screen.getByText('Risk B')).toBeInTheDocument()
  })

  test('scope section renders in/out items', () => {
    render(
      <PlanDrawer
        loaded={true}
        onClose={vi.fn()}
        open={true}
        plan={FULL_PLAN}
        workspacePath={null}
      />
    )
    expect(screen.getByText('Core')).toBeInTheDocument()
    expect(screen.getByText('Extras')).toBeInTheDocument()
  })

  test('currentPhase renders when present', () => {
    render(
      <PlanDrawer
        loaded={true}
        onClose={vi.fn()}
        open={true}
        plan={FULL_PLAN}
        workspacePath={null}
      />
    )
    expect(screen.getByText('M1 — stabilizing')).toBeInTheDocument()
  })

  test('frontmatter title shown in PlanHeader', () => {
    render(
      <PlanDrawer
        loaded={true}
        onClose={vi.fn()}
        open={true}
        plan={FULL_PLAN}
        workspacePath={null}
      />
    )
    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings.some((h) => h.textContent === 'Test Project')).toBe(true)
  })
})
