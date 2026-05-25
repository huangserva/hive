// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { I18nProvider } from '../../web/src/i18n.js'
import { RuntimeStatusStrip } from '../../web/src/layout/RuntimeStatusStrip.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const mockRuntimeStatus = () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        cwd: '/Users/me/project',
        db_path: '/Users/me/.config/hive/runtime.sqlite',
        log_path: '/Users/me/.config/hive/logs/runtime-4010.log',
        pid: 4242,
        port: 4010,
        version: '1.2.3-test',
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  )
}

describe('RuntimeStatusStrip', () => {
  test('renders compact runtime status and exposes full local paths', async () => {
    mockRuntimeStatus()

    render(
      <I18nProvider>
        <RuntimeStatusStrip />
      </I18nProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('runtime-status-strip')).toBeInTheDocument()
    })

    expect(screen.getByText('Runtime')).toBeInTheDocument()
    expect(screen.getByText('4010')).toBeInTheDocument()
    expect(screen.getByText('pid 4242')).toBeInTheDocument()
    expect(screen.getByText('v1.2.3-test')).toBeInTheDocument()
    const strip = screen.getByTestId('runtime-status-strip')
    expect(strip).toHaveTextContent('runtime-4010.log')
    expect(strip).toHaveAttribute('title', expect.stringContaining('/Users/me/project'))
    expect(strip).toHaveAttribute(
      'title',
      expect.stringContaining('/Users/me/.config/hive/runtime.sqlite')
    )
  })
})
