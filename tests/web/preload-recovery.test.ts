// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'

import { registerPreloadErrorRecovery } from '../../web/src/preload-recovery.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('registerPreloadErrorRecovery', () => {
  test('prevents the Vite preload error default and reloads the current page', () => {
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    })
    registerPreloadErrorRecovery(window)

    const event = new Event('vite:preloadError', { cancelable: true })
    const preventDefault = vi.spyOn(event, 'preventDefault')

    window.dispatchEvent(event)

    expect(preventDefault).toHaveBeenCalled()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
