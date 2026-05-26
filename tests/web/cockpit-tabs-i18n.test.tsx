// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { CockpitTabs } from '../../web/src/cockpit/CockpitTabs.js'
import { I18nProvider } from '../../web/src/i18n.js'
import { UI_LANGUAGE_STORAGE_KEY } from '../../web/src/uiLanguage.js'

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

const makeCockpit = () => ({
  aiActions: [],
  archive: { months: [], parseError: null },
  baseline: { children: [], parseError: null, readme: null, staleHint: null },
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
  reports: { entries: [], parseError: null, totalCount: 0 },
  tasks: { parseError: null, raw: '', sections: [], totalDone: 0, totalOpen: 0 },
})

describe('CockpitTabs i18n', () => {
  test('EN locale renders English tab labels', () => {
    render(
      <I18nProvider>
        <CockpitTabs activeTab="plan" cockpit={makeCockpit()} onChange={() => {}} />
      </I18nProvider>
    )
    expect(screen.getByText('Plan')).toBeInTheDocument()
    expect(screen.getByText('Tasks')).toBeInTheDocument()
    expect(screen.getByText('Questions')).toBeInTheDocument()
    expect(screen.getByText('Ideas')).toBeInTheDocument()
    expect(screen.getByText('Decisions')).toBeInTheDocument()
    expect(screen.getByText('Research')).toBeInTheDocument()
    expect(screen.getByText('Reports')).toBeInTheDocument()
    expect(screen.getByText('Timeline')).toBeInTheDocument()
    expect(screen.getByText('Baseline')).toBeInTheDocument()
    expect(screen.getByText('Archive')).toBeInTheDocument()
  })

  test('ZH locale renders Chinese tab labels', () => {
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, 'zh')
    render(
      <I18nProvider>
        <CockpitTabs activeTab="plan" cockpit={makeCockpit()} onChange={() => {}} />
      </I18nProvider>
    )
    expect(screen.getByText('计划')).toBeInTheDocument()
    expect(screen.getByText('任务')).toBeInTheDocument()
    expect(screen.getByText('问题')).toBeInTheDocument()
    expect(screen.getByText('想法')).toBeInTheDocument()
    expect(screen.getByText('决策')).toBeInTheDocument()
    expect(screen.getByText('调研')).toBeInTheDocument()
    expect(screen.getByText('报告')).toBeInTheDocument()
    expect(screen.getByText('时间线')).toBeInTheDocument()
    expect(screen.getByText('基线')).toBeInTheDocument()
    expect(screen.getByText('归档')).toBeInTheDocument()
  })

  test('active tab button is aria-pressed true', () => {
    render(
      <I18nProvider>
        <CockpitTabs activeTab="tasks" cockpit={makeCockpit()} onChange={() => {}} />
      </I18nProvider>
    )
    expect(screen.getByText('Tasks').closest('button')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Plan').closest('button')).toHaveAttribute('aria-pressed', 'false')
  })
})
