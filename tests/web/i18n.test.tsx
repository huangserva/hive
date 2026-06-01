// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { AppProviders } from '../../web/src/AppProviders.js'
import { I18nProvider, useI18n } from '../../web/src/i18n.js'
import { Topbar } from '../../web/src/layout/Topbar.js'
import { UI_LANGUAGE_STORAGE_KEY } from '../../web/src/uiLanguage.js'
import { WelcomePane } from '../../web/src/worker/WelcomePane.js'

const versionInfo = {
  currentVersion: '0.6.0-alpha.5',
  installHint: 'npm update -g @tt-a1i/hive',
  latestVersion: '0.6.0-alpha.5',
  packageName: '@tt-a1i/hive',
  releaseUrl: 'https://www.npmjs.com/package/@tt-a1i/hive',
  updateAvailable: false,
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('UI language switcher', () => {
  test('switches shell copy to Chinese and persists the choice', () => {
    render(
      <AppProviders>
        <Topbar
          onToggleTaskGraph={() => {}}
          taskGraphOpen={false}
          version="0.6.0-alpha.5"
          versionInfo={versionInfo}
        />
        <WelcomePane onAddWorkspace={() => {}} />
      </AppProviders>
    )

    expect(screen.getByText('Welcome to HippoTeam')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Switch language to 中文' }))

    expect(screen.getByText('欢迎使用 HippoTeam')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /添加第一个 Workspace/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '切换语言到 English' })).toBeInTheDocument()
    expect(window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY)).toBe('zh')
  })

  test('still switches for the current session when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    render(
      <AppProviders>
        <Topbar
          onToggleTaskGraph={() => {}}
          taskGraphOpen={false}
          version="0.6.0-alpha.5"
          versionInfo={versionInfo}
        />
        <WelcomePane onAddWorkspace={() => {}} />
      </AppProviders>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Switch language to 中文' }))

    expect(screen.getByText('欢迎使用 HippoTeam')).toBeInTheDocument()
  })
})

const I18nReporter = ({ onValue }: { onValue: (t: ReturnType<typeof useI18n>['t']) => void }) => {
  const { t } = useI18n()
  onValue(t)
  return <div data-testid="i18n-reporter" />
}

const COCKPIT_KEYS = [
  'cockpit.title',
  'cockpit.subtitle',
  'cockpit.close',
  'cockpit.loading',
  'cockpit.connection.live',
  'cockpit.connection.loading',
  'cockpit.tabs.plan',
  'cockpit.tabs.tasks',
  'cockpit.tabs.questions',
  'cockpit.tabs.ideas',
  'cockpit.tabs.decisions',
  'cockpit.tabs.research',
  'cockpit.tabs.reports',
  'cockpit.tabs.baseline',
  'cockpit.tabs.archive',
  'cockpit.actionBar.title',
  'cockpit.actionBar.empty',
  'cockpit.actionBar.priority.high',
  'cockpit.actionBar.priority.medium',
  'cockpit.actionBar.priority.low',
  'cockpit.actionBar.action.answer',
  'cockpit.actionBar.action.view',
  'cockpit.actionBar.action.confirm',
  'cockpit.actionBar.action.addNote',
  'cockpit.actionBar.action.prepare',
  'cockpit.actionBar.action.startImpl',
] as const

const PLAN_KEYS = [
  'plan.drawer.title',
  'plan.drawer.close',
  'plan.milestone.shipped',
  'plan.milestone.inProgress',
  'plan.milestone.blocked',
  'plan.goal.title',
  'plan.scope.title',
  'plan.risk.title',
] as const

const FEISHU_KEYS = [
  'feishu.label',
  'feishu.status.connected',
  'feishu.status.disconnected',
  'feishu.status.error',
  'feishu.status.disabled',
  'feishu.indicator.tooltip',
  'feishu.indicator.reconnects',
  'feishu.settings.title',
] as const

const TOPBAR_KEYS = [
  'topbar.cockpit',
  'topbar.todo',
  'topbar.showCockpit',
  'topbar.hideCockpit',
] as const

describe('PM i18n key completeness', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  test('all cockpit keys produce non-empty string in both locales', () => {
    const translations: Record<string, { en: string; zh: string }> = {}
    let collector: (t: ReturnType<typeof useI18n>['t']) => void

    const collectTranslations = (locale: 'en' | 'zh') =>
      new Promise<void>((resolve) => {
        collector = (t) => {
          for (const key of COCKPIT_KEYS) {
            if (!translations[key]) translations[key] = { en: '', zh: '' }
            translations[key][locale] = t(key)
          }
          resolve()
        }
      })

    const enDone = collectTranslations('en')
    render(
      <I18nProvider>
        <I18nReporter onValue={(t) => collector(t)} />
      </I18nProvider>
    )
    void enDone

    for (const key of COCKPIT_KEYS) {
      expect(translations[key]?.en, `${key} should have EN value`).toBeTruthy()
    }

    cleanup()

    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, 'zh')
    const zhDone = collectTranslations('zh')
    render(
      <I18nProvider>
        <I18nReporter onValue={(t) => collector(t)} />
      </I18nProvider>
    )
    void zhDone

    for (const key of COCKPIT_KEYS) {
      expect(translations[key]?.zh, `${key} should have ZH value`).toBeTruthy()
    }
  })

  test('cockpit title and tabs differ between EN and ZH', () => {
    const results: Record<string, { en: string; zh: string }> = {}
    let collector: (t: ReturnType<typeof useI18n>['t']) => void

    const sampleKeys = [
      'cockpit.title',
      'cockpit.tabs.questions',
      'cockpit.actionBar.title',
    ] as const

    const collectEn = new Promise<void>((resolve) => {
      collector = (t) => {
        for (const key of sampleKeys) {
          results[key] = { en: t(key), zh: '' }
        }
        resolve()
      }
    })
    render(
      <I18nProvider>
        <I18nReporter onValue={(t) => collector(t)} />
      </I18nProvider>
    )
    void collectEn
    cleanup()

    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, 'zh')
    const collectZh = new Promise<void>((resolve) => {
      collector = (t) => {
        for (const key of sampleKeys) {
          results[key].zh = t(key)
        }
        resolve()
      }
    })
    render(
      <I18nProvider>
        <I18nReporter onValue={(t) => collector(t)} />
      </I18nProvider>
    )
    void collectZh

    expect(results['cockpit.title']?.en).toBe('Cockpit')
    expect(results['cockpit.title']?.zh).toBe('Cockpit')
    expect(results['cockpit.tabs.questions']?.en).toBe('Questions')
    expect(results['cockpit.tabs.questions']?.zh).toBe('问题')
    expect(results['cockpit.actionBar.title']?.en).toBe('AI-ready actions')
    expect(results['cockpit.actionBar.title']?.zh).toBe('AI 准备好的待办行动')
  })

  test('plan milestone statuses differ between locales', () => {
    const results: Record<string, { en: string; zh: string }> = {}
    let collector: (t: ReturnType<typeof useI18n>['t']) => void

    const collectEn = new Promise<void>((resolve) => {
      collector = (t) => {
        results.shipped = { en: t('plan.milestone.shipped'), zh: '' }
        resolve()
      }
    })
    render(
      <I18nProvider>
        <I18nReporter onValue={(t) => collector(t)} />
      </I18nProvider>
    )
    void collectEn
    cleanup()

    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, 'zh')
    const collectZh = new Promise<void>((resolve) => {
      collector = (t) => {
        results.shipped.zh = t('plan.milestone.shipped')
        resolve()
      }
    })
    render(
      <I18nProvider>
        <I18nReporter onValue={(t) => collector(t)} />
      </I18nProvider>
    )
    void collectZh

    expect(results.shipped?.en).toBe('Shipped')
    expect(results.shipped?.zh).toBe('已交付')
  })

  test('feishu status keys differ between locales', () => {
    const results: Record<string, { en: string; zh: string }> = {}
    let collector: (t: ReturnType<typeof useI18n>['t']) => void

    const collectEn = new Promise<void>((resolve) => {
      collector = (t) => {
        results.connected = { en: t('feishu.status.connected'), zh: '' }
        results.disabled = { en: t('feishu.status.disabled'), zh: '' }
        resolve()
      }
    })
    render(
      <I18nProvider>
        <I18nReporter onValue={(t) => collector(t)} />
      </I18nProvider>
    )
    void collectEn
    cleanup()

    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, 'zh')
    const collectZh = new Promise<void>((resolve) => {
      collector = (t) => {
        results.connected.zh = t('feishu.status.connected')
        results.disabled.zh = t('feishu.status.disabled')
        resolve()
      }
    })
    render(
      <I18nProvider>
        <I18nReporter onValue={(t) => collector(t)} />
      </I18nProvider>
    )
    void collectZh

    expect(results.connected?.en).toBe('Connected')
    expect(results.connected?.zh).toBe('已连接')
    expect(results.disabled?.en).toBe('Not configured')
    expect(results.disabled?.zh).toBe('未配置')
  })

  test('all plan and feishu and topbar keys have non-empty EN values', () => {
    const allKeys = [...PLAN_KEYS, ...FEISHU_KEYS, ...TOPBAR_KEYS]
    let collector: (t: ReturnType<typeof useI18n>['t']) => void

    const values: string[] = []
    const done = new Promise<void>((resolve) => {
      collector = (t) => {
        for (const key of allKeys) {
          values.push(t(key))
        }
        resolve()
      }
    })
    render(
      <I18nProvider>
        <I18nReporter onValue={(t) => collector(t)} />
      </I18nProvider>
    )
    void done

    for (let i = 0; i < allKeys.length; i++) {
      expect(values[i], `${allKeys[i]} should have EN value`).toBeTruthy()
    }
  })
})
