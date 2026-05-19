import { useEffect, useState } from 'react'

export type DisplayMode =
  | 'browser'
  | 'standalone'
  | 'window-controls-overlay'
  | 'fullscreen'
  | 'minimal-ui'

const QUERY_BY_MODE: Record<Exclude<DisplayMode, 'browser'>, string> = {
  standalone: '(display-mode: standalone)',
  'window-controls-overlay': '(display-mode: window-controls-overlay)',
  fullscreen: '(display-mode: fullscreen)',
  'minimal-ui': '(display-mode: minimal-ui)',
}

const detectDisplayMode = (): DisplayMode => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'browser'
  }
  for (const mode of Object.keys(QUERY_BY_MODE) as Array<Exclude<DisplayMode, 'browser'>>) {
    if (window.matchMedia(QUERY_BY_MODE[mode]).matches) return mode
  }
  return 'browser'
}

/**
 * Reflect the current PWA `display-mode`. Returns `'browser'` for normal tabs
 * and one of `'standalone' | 'window-controls-overlay' | 'fullscreen' |
 * 'minimal-ui'` when the document is being rendered as an installed app. Stays
 * in sync via `matchMedia('change')` so toggling between window types or
 * entering/leaving fullscreen updates consumers without a reload.
 */
export const useDisplayMode = (): DisplayMode => {
  const [mode, setMode] = useState<DisplayMode>(detectDisplayMode)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const cleanups: Array<() => void> = []
    const handleChange = () => setMode(detectDisplayMode())
    for (const query of Object.values(QUERY_BY_MODE)) {
      const mediaQuery = window.matchMedia(query)
      mediaQuery.addEventListener('change', handleChange)
      cleanups.push(() => mediaQuery.removeEventListener('change', handleChange))
    }
    return () => {
      for (const cleanup of cleanups) cleanup()
    }
  }, [])

  return mode
}
