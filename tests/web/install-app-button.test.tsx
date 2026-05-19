// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { InstallAppButton } from '../../web/src/pwa/InstallAppButton.js'

const setupMatchMedia = (matching: ReadonlyArray<string> = []) => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matching.includes(query),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

interface DispatchInstallArgs {
  outcome?: 'accepted' | 'dismissed'
  promptImpl?: () => Promise<void>
}

const dispatchInstall = ({ outcome = 'accepted', promptImpl }: DispatchInstallArgs = {}) => {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  const prompt = vi.fn<() => Promise<void>>(promptImpl ?? (() => Promise.resolve()))
  Object.assign(event, {
    prompt,
    userChoice: Promise.resolve({ outcome }),
  })
  window.dispatchEvent(event)
  return { prompt }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('InstallAppButton', () => {
  test('renders nothing in browser display mode until a beforeinstallprompt event arrives', () => {
    setupMatchMedia([])
    const { container } = render(<InstallAppButton />)
    expect(container.firstChild).toBeNull()
  })

  test('renders the install button once a prompt event is cached', () => {
    setupMatchMedia([])
    render(<InstallAppButton />)
    act(() => {
      dispatchInstall()
    })
    expect(screen.getByTestId('topbar-install')).toBeTruthy()
  })

  test('hidden whenever the display mode is anything other than browser', () => {
    setupMatchMedia(['(display-mode: standalone)'])
    const { container } = render(<InstallAppButton />)
    act(() => {
      dispatchInstall()
    })
    // Even with a prompt cached, the button must not appear when running as PWA.
    expect(container.firstChild).toBeNull()
  })

  test('clicking the button invokes the cached prompt exactly once', async () => {
    setupMatchMedia([])
    render(<InstallAppButton />)
    let captured: { prompt: ReturnType<typeof vi.fn> } | undefined
    act(() => {
      captured = dispatchInstall({ outcome: 'accepted' })
    })

    const button = screen.getByTestId('topbar-install')
    await act(async () => {
      fireEvent.click(button)
      // Let the chained promise (event.prompt + userChoice) settle.
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(captured?.prompt).toHaveBeenCalledTimes(1)
  })

  test('button hides after a successful prompt is consumed', async () => {
    setupMatchMedia([])
    render(<InstallAppButton />)
    act(() => {
      dispatchInstall({ outcome: 'accepted' })
    })
    expect(screen.queryByTestId('topbar-install')).not.toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByTestId('topbar-install'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.queryByTestId('topbar-install')).toBeNull()
  })

  test('button stays disabled while the prompt is open', () => {
    setupMatchMedia([])
    render(<InstallAppButton />)
    // Use a prompt that never resolves so we can observe the prompting=true state.
    act(() => {
      dispatchInstall({ promptImpl: () => new Promise(() => {}) })
    })
    const button = screen.getByTestId('topbar-install') as HTMLButtonElement
    fireEvent.click(button)
    expect(button.disabled).toBe(true)
  })

  test('aria-label switches to the installing string while the prompt is open', () => {
    setupMatchMedia([])
    render(<InstallAppButton />)
    act(() => {
      dispatchInstall({ promptImpl: () => new Promise(() => {}) })
    })
    const button = screen.getByTestId('topbar-install') as HTMLButtonElement
    const labelBefore = button.getAttribute('aria-label')
    fireEvent.click(button)
    const labelDuring = button.getAttribute('aria-label')
    expect(labelDuring).not.toBe(labelBefore)
    expect(labelDuring).not.toBeNull()
  })
})
