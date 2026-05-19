// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { useDisplayMode } from '../../web/src/pwa/use-display-mode.js'

interface MockMediaQueryList {
  matches: boolean
  media: string
  listeners: Set<(event: MediaQueryListEvent) => void>
  addEventListener(type: 'change', listener: (event: MediaQueryListEvent) => void): void
  removeEventListener(type: 'change', listener: (event: MediaQueryListEvent) => void): void
}

const setupMatchMedia = (matchingQueries: ReadonlyArray<string> = []) => {
  const lists = new Map<string, MockMediaQueryList>()
  const matchMedia = (query: string): MockMediaQueryList => {
    const existing = lists.get(query)
    if (existing) return existing
    const list: MockMediaQueryList = {
      matches: matchingQueries.includes(query),
      media: query,
      listeners: new Set(),
      addEventListener(_type, listener) {
        this.listeners.add(listener)
      },
      removeEventListener(_type, listener) {
        this.listeners.delete(listener)
      },
    }
    lists.set(query, list)
    return list
  }
  vi.stubGlobal('matchMedia', matchMedia)
  return {
    fireChange(query: string, matches: boolean) {
      const list = lists.get(query)
      if (!list) throw new Error(`matchMedia(${query}) was never instantiated`)
      list.matches = matches
      const event = { matches, media: query } as unknown as MediaQueryListEvent
      for (const listener of list.listeners) listener(event)
    },
    listFor(query: string) {
      return lists.get(query)
    },
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useDisplayMode', () => {
  test('returns "browser" when no display-mode query matches', () => {
    setupMatchMedia([])
    const { result } = renderHook(() => useDisplayMode())
    expect(result.current).toBe('browser')
  })

  test('returns "standalone" when (display-mode: standalone) matches', () => {
    setupMatchMedia(['(display-mode: standalone)'])
    const { result } = renderHook(() => useDisplayMode())
    expect(result.current).toBe('standalone')
  })

  test('returns "window-controls-overlay" when WCO matches', () => {
    setupMatchMedia(['(display-mode: window-controls-overlay)'])
    const { result } = renderHook(() => useDisplayMode())
    expect(result.current).toBe('window-controls-overlay')
  })

  test('returns "fullscreen" and "minimal-ui" when their queries match', () => {
    setupMatchMedia(['(display-mode: fullscreen)'])
    const a = renderHook(() => useDisplayMode())
    expect(a.result.current).toBe('fullscreen')
    a.unmount()

    setupMatchMedia(['(display-mode: minimal-ui)'])
    const b = renderHook(() => useDisplayMode())
    expect(b.result.current).toBe('minimal-ui')
    b.unmount()
  })

  test('updates when matchMedia.change fires', () => {
    const mq = setupMatchMedia([])
    const { result } = renderHook(() => useDisplayMode())
    expect(result.current).toBe('browser')

    act(() => {
      mq.fireChange('(display-mode: standalone)', true)
    })
    expect(result.current).toBe('standalone')

    act(() => {
      mq.fireChange('(display-mode: standalone)', false)
    })
    expect(result.current).toBe('browser')
  })

  test('removes its listeners on unmount', () => {
    const mq = setupMatchMedia([])
    const { unmount } = renderHook(() => useDisplayMode())
    const list = mq.listFor('(display-mode: standalone)')
    if (!list) throw new Error('expected standalone query to be observed')
    expect(list.listeners.size).toBe(1)
    unmount()
    expect(list.listeners.size).toBe(0)
  })
})
