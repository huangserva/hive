// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { AIAction } from '../../web/src/api.js'
import { ActionBar } from '../../web/src/cockpit/ActionBar.js'
import { I18nProvider } from '../../web/src/i18n.js'
import { UI_LANGUAGE_STORAGE_KEY } from '../../web/src/uiLanguage.js'

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

const makeAction = (overrides: Partial<AIAction> = {}): AIAction => ({
  action: 'answer',
  id: 'q-1',
  priority: 'high',
  targetTab: 'questions',
  text: 'Answer Q1',
  type: 'question',
  ...overrides,
})

describe('ActionBar i18n', () => {
  test('EN locale renders English title and empty state', () => {
    render(
      <I18nProvider>
        <ActionBar actions={[]} />
      </I18nProvider>
    )
    expect(screen.getByText('AI-ready actions')).toBeInTheDocument()
    expect(screen.getByText('No AI actions are waiting for user input.')).toBeInTheDocument()
  })

  test('ZH locale renders Chinese title and empty state', () => {
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, 'zh')
    render(
      <I18nProvider>
        <ActionBar actions={[]} />
      </I18nProvider>
    )
    expect(screen.getByText('AI 准备好的待办行动')).toBeInTheDocument()
    expect(screen.getByText('当前没有 AI 等待 user 处理的行动。')).toBeInTheDocument()
  })

  test('EN locale renders localized priority labels', () => {
    const actions = [
      makeAction({ id: 'a', priority: 'high' }),
      makeAction({ id: 'b', priority: 'medium' }),
      makeAction({ id: 'c', priority: 'low' }),
    ]
    render(
      <I18nProvider>
        <ActionBar actions={actions} />
      </I18nProvider>
    )
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.getByText('Medium')).toBeInTheDocument()
    expect(screen.getByText('Low')).toBeInTheDocument()
  })

  test('ZH locale renders Chinese priority labels', () => {
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, 'zh')
    const actions = [
      makeAction({ id: 'a', priority: 'high' }),
      makeAction({ id: 'b', priority: 'medium' }),
    ]
    render(
      <I18nProvider>
        <ActionBar actions={actions} />
      </I18nProvider>
    )
    expect(screen.getByText('高')).toBeInTheDocument()
    expect(screen.getByText('中')).toBeInTheDocument()
  })

  test('renders action count in both locales', () => {
    const actions = [makeAction(), makeAction({ id: 'q-2' })]
    const { unmount } = render(
      <I18nProvider>
        <ActionBar actions={actions} />
      </I18nProvider>
    )
    expect(screen.getByText('(2)')).toBeInTheDocument()
    unmount()

    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, 'zh')
    render(
      <I18nProvider>
        <ActionBar actions={actions} />
      </I18nProvider>
    )
    expect(screen.getByText('(2)')).toBeInTheDocument()
  })

  test('EN locale translates known backend Chinese action labels per action', () => {
    const actions = [
      makeAction({ action: '查看', id: 'view', text: 'View item', type: 'audit' }),
      makeAction({ action: '回答', id: 'answer', text: 'Answer item', type: 'question' }),
      makeAction({ action: '确认', id: 'confirm', text: 'Confirm item', type: 'decision' }),
    ]
    render(
      <I18nProvider>
        <ActionBar actions={actions} />
      </I18nProvider>
    )
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Answer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '查看' })).not.toBeInTheDocument()
  })

  test('EN locale translates audit/playbook/impl backend Chinese action labels', () => {
    const actions = [
      makeAction({ action: '补 note', id: 'note', text: 'Add research note', type: 'audit' }),
      makeAction({ action: '准备', id: 'prep', text: 'Prepare handoff brief', type: 'playbook' }),
      makeAction({
        action: '开实施',
        id: 'impl',
        text: 'Open impl milestone',
        type: 'missing_impl_milestone',
      }),
    ]
    render(
      <I18nProvider>
        <ActionBar actions={actions} />
      </I18nProvider>
    )
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prepare' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start impl' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '补 note' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '开实施' })).not.toBeInTheDocument()
  })

  // M34 风险2：新 unreviewed_code action 的"派 reviewer"动词必须本地化（避免英文 UI 显示中文）。
  test('EN locale translates the M34 unreviewed_code action label (派 reviewer → Assign reviewer)', () => {
    const actions = [
      makeAction({
        action: '派 reviewer',
        id: 'unreviewed-code:abc',
        text: '关羽 的代码改动尚未派 reviewer 审查',
        type: 'unreviewed_code',
      }),
    ]
    render(
      <I18nProvider>
        <ActionBar actions={actions} />
      </I18nProvider>
    )
    expect(screen.getByRole('button', { name: 'Assign reviewer' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '派 reviewer' })).not.toBeInTheDocument()
  })

  test('ZH locale renders the M34 unreviewed_code action label as 派 reviewer', () => {
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, 'zh')
    const actions = [
      makeAction({
        action: '派 reviewer',
        id: 'unreviewed-code:abc',
        text: '关羽 的代码改动尚未派 reviewer 审查',
        type: 'unreviewed_code',
      }),
    ]
    render(
      <I18nProvider>
        <ActionBar actions={actions} />
      </I18nProvider>
    )
    expect(screen.getByRole('button', { name: '派 reviewer' })).toBeInTheDocument()
  })
})
