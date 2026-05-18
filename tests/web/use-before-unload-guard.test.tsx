// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'

import { useBeforeUnloadGuard } from '../../web/src/useBeforeUnloadGuard.js'

const dispatchBeforeUnload = () => {
  const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
  Object.defineProperty(event, 'returnValue', {
    configurable: true,
    value: undefined,
    writable: true,
  })
  const allowed = window.dispatchEvent(event)
  return { allowed, event }
}

afterEach(() => {
  cleanup()
})

describe('useBeforeUnloadGuard', () => {
  test('prevents tab close while protected work is running', () => {
    renderHook(() => useBeforeUnloadGuard(true))

    const { allowed, event } = dispatchBeforeUnload()

    expect(allowed).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    expect(event.returnValue).toBe('')
  })

  test('does not intercept tab close when guard is disabled', () => {
    const { rerender } = renderHook(({ enabled }) => useBeforeUnloadGuard(enabled), {
      initialProps: { enabled: true },
    })
    rerender({ enabled: false })

    const { allowed, event } = dispatchBeforeUnload()

    expect(allowed).toBe(true)
    expect(event.defaultPrevented).toBe(false)
  })
})
