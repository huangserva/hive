// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { useInstallPrompt } from '../../web/src/pwa/use-install-prompt.js'

interface FakePromptArgs {
  outcome?: 'accepted' | 'dismissed'
  promptImpl?: () => Promise<void>
}

const dispatchBeforeInstallPrompt = ({ outcome = 'accepted', promptImpl }: FakePromptArgs = {}) => {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  const promptFn = vi.fn<() => Promise<void>>(promptImpl ?? (() => Promise.resolve()))
  const preventDefault = vi.spyOn(event, 'preventDefault')
  Object.assign(event, {
    prompt: promptFn,
    userChoice: Promise.resolve({ outcome }),
  })
  window.dispatchEvent(event)
  return { promptFn, preventDefault, event }
}

afterEach(() => {
  cleanup()
})

describe('useInstallPrompt', () => {
  test('starts unavailable and not prompting', () => {
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.available).toBe(false)
    expect(result.current.prompting).toBe(false)
  })

  test('beforeinstallprompt sets available=true and the event is captured (preventDefault called)', () => {
    const { result } = renderHook(() => useInstallPrompt())
    let captured: { preventDefault: ReturnType<typeof vi.spyOn> } | undefined
    act(() => {
      captured = dispatchBeforeInstallPrompt()
    })
    if (!captured) throw new Error('expected beforeinstallprompt to be dispatched')
    expect(result.current.available).toBe(true)
    expect(captured.preventDefault).toHaveBeenCalled()
  })

  test('prompt() returns "unavailable" when no event has been cached', async () => {
    const { result } = renderHook(() => useInstallPrompt())
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.prompt()
    })
    expect(outcome).toBe('unavailable')
  })

  test('prompt() invokes the cached event and resolves with the user choice', async () => {
    const { result } = renderHook(() => useInstallPrompt())
    let captured: { promptFn: ReturnType<typeof vi.fn> } | undefined
    act(() => {
      captured = dispatchBeforeInstallPrompt({ outcome: 'accepted' })
    })

    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.prompt()
    })

    expect(outcome).toBe('accepted')
    expect(captured?.promptFn).toHaveBeenCalledTimes(1)
    // After consumption the event is exhausted (per spec) so available must
    // flip back to false. Otherwise the UI would let users click the install
    // button after they already installed.
    expect(result.current.available).toBe(false)
  })

  test('prompt() flips prompting=true while the prompt is open and back when it resolves', async () => {
    let resolvePrompt: (() => void) | undefined
    const promptImpl = () =>
      new Promise<void>((resolve) => {
        resolvePrompt = resolve
      })
    const { result } = renderHook(() => useInstallPrompt())
    act(() => {
      dispatchBeforeInstallPrompt({ promptImpl })
    })

    let outcomePromise: Promise<string> | undefined
    act(() => {
      outcomePromise = result.current.prompt()
    })
    expect(result.current.prompting).toBe(true)

    await act(async () => {
      resolvePrompt?.()
      await outcomePromise
    })
    expect(result.current.prompting).toBe(false)
  })

  test('appinstalled clears the cached event', () => {
    const { result } = renderHook(() => useInstallPrompt())
    act(() => {
      dispatchBeforeInstallPrompt()
    })
    expect(result.current.available).toBe(true)
    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })
    expect(result.current.available).toBe(false)
  })

  test('listeners are removed on unmount', () => {
    const { unmount, result } = renderHook(() => useInstallPrompt())
    unmount()
    // After unmount, dispatching beforeinstallprompt must not flip state on
    // the stale hook result.
    window.dispatchEvent(new Event('beforeinstallprompt'))
    expect(result.current.available).toBe(false)
  })
})
