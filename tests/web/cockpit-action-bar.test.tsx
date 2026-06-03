// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { AIAction } from '../../web/src/api.js'
import { ActionBar } from '../../web/src/cockpit/ActionBar.js'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

const makeAction = (overrides: Partial<AIAction> = {}): AIAction => ({
  action: '回答',
  id: 'q-1',
  priority: 'high',
  targetTab: 'questions',
  text: 'Answer Q1',
  type: 'question',
  ...overrides,
})

const actionBarHeaderName = /AI-ready actions|AI 准备好的待办行动/

describe('ActionBar', () => {
  test('renders empty state when no actions', () => {
    render(<ActionBar actions={[]} />)
    expect(screen.getByText(/当前没有 AI 等待 user 处理的行动/)).toBeInTheDocument()
  })

  test('renders action count in header', () => {
    const actions = [makeAction(), makeAction({ id: 'q-2', text: 'Answer Q2' })]
    render(<ActionBar actions={actions} />)
    expect(screen.getByText('(2)')).toBeInTheDocument()
  })

  test('renders at most 10 actions', () => {
    const actions = Array.from({ length: 15 }, (_, i) =>
      makeAction({ id: `q-${i}`, text: `Action ${i}` })
    )
    render(<ActionBar actions={actions} />)
    expect(screen.getByText('(15)')).toBeInTheDocument()
    const items = screen.getAllByRole('button', { name: '回答' })
    expect(items).toHaveLength(10)
  })

  test('renders priority labels: 高/中/低', () => {
    const actions = [
      makeAction({ id: 'a', priority: 'high' }),
      makeAction({ id: 'b', priority: 'medium' }),
      makeAction({ id: 'c', priority: 'low' }),
    ]
    render(<ActionBar actions={actions} />)
    expect(screen.getByText('高')).toBeInTheDocument()
    expect(screen.getByText('中')).toBeInTheDocument()
    expect(screen.getByText('低')).toBeInTheDocument()
  })

  test('renders action text and action button label', () => {
    render(<ActionBar actions={[makeAction()]} />)
    expect(screen.getByText('Answer Q1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '回答' })).toBeInTheDocument()
  })

  test('defaults to expanded and renders actions', () => {
    render(<ActionBar actions={[makeAction(), makeAction({ id: 'q-2', text: 'Answer Q2' })]} />)

    expect(screen.getByText('(2)')).toBeInTheDocument()
    expect(screen.getByText('Answer Q1')).toBeInTheDocument()
    expect(screen.getByText('Answer Q2')).toBeInTheDocument()
  })

  test('collapses action list from the header while keeping count visible', () => {
    render(<ActionBar actions={[makeAction(), makeAction({ id: 'q-2', text: 'Answer Q2' })]} />)

    fireEvent.click(screen.getByRole('button', { name: actionBarHeaderName }))

    expect(screen.getByText('(2)')).toBeInTheDocument()
    expect(screen.queryByText('Answer Q1')).not.toBeInTheDocument()
    expect(screen.queryByText('Answer Q2')).not.toBeInTheDocument()
  })

  test('persists collapsed state in localStorage', () => {
    const { unmount } = render(<ActionBar actions={[makeAction()]} />)

    fireEvent.click(screen.getByRole('button', { name: actionBarHeaderName }))
    expect(window.localStorage.getItem('hive.cockpit.actionBar.collapsed')).toBe('1')
    unmount()

    render(<ActionBar actions={[makeAction()]} />)
    expect(screen.getByText('(1)')).toBeInTheDocument()
    expect(screen.queryByText('Answer Q1')).not.toBeInTheDocument()
  })

  test('expands again after a second header click', () => {
    window.localStorage.setItem('hive.cockpit.actionBar.collapsed', '1')
    render(<ActionBar actions={[makeAction()]} />)

    fireEvent.click(screen.getByRole('button', { name: actionBarHeaderName }))

    expect(screen.getByText('Answer Q1')).toBeInTheDocument()
    expect(window.localStorage.getItem('hive.cockpit.actionBar.collapsed')).toBe('0')
  })

  test('dispatches action button clicks to the parent handler', () => {
    const onAction = vi.fn()
    const action = makeAction()
    render(<ActionBar actions={[action]} onAction={onAction} />)

    fireEvent.click(screen.getByRole('button', { name: '回答' }))

    expect(onAction).toHaveBeenCalledWith(action)
  })
})
