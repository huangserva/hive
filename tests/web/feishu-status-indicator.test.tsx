// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { FeishuStatusIndicator } from '../../web/src/feishu/FeishuStatusIndicator.js'
import { I18nProvider } from '../../web/src/i18n.js'
import { UI_LANGUAGE_STORAGE_KEY } from '../../web/src/uiLanguage.js'

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

const mockFeishuStatus = (status: string, overrides: Record<string, unknown> = {}) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ status, ...overrides }), {
      headers: { 'Content-Type': 'application/json' },
    })
  )
}

describe('FeishuStatusIndicator', () => {
  test('EN connected shows "Feishu" label', async () => {
    mockFeishuStatus('connected', { appId: 'cli_test123' })
    render(
      <I18nProvider>
        <FeishuStatusIndicator />
      </I18nProvider>
    )
    await waitFor(() => {
      expect(screen.getByTestId('feishu-status-indicator')).toBeInTheDocument()
    })
    expect(screen.getByText('Feishu')).toBeInTheDocument()
  })

  test('ZH connected shows "飞书" label', async () => {
    window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, 'zh')
    mockFeishuStatus('connected')
    render(
      <I18nProvider>
        <FeishuStatusIndicator />
      </I18nProvider>
    )
    await waitFor(() => {
      expect(screen.getByTestId('feishu-status-indicator')).toBeInTheDocument()
    })
    expect(screen.getByText('飞书')).toBeInTheDocument()
  })

  test('fetch error falls back to error status', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))
    render(
      <I18nProvider>
        <FeishuStatusIndicator />
      </I18nProvider>
    )
    await waitFor(() => {
      expect(screen.getByTestId('feishu-status-indicator')).toBeInTheDocument()
    })
  })

  test('clicking indicator does not navigate or throw', async () => {
    mockFeishuStatus('disabled')
    render(
      <I18nProvider>
        <FeishuStatusIndicator />
      </I18nProvider>
    )
    await waitFor(() => {
      expect(screen.getByTestId('feishu-status-indicator')).toBeInTheDocument()
    })
    const indicator = screen.getByTestId('feishu-status-indicator')
    expect(() => indicator.click()).not.toThrow()
  })
})
