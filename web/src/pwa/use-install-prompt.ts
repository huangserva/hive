import { useCallback, useEffect, useState } from 'react'

// Subset of the BeforeInstallPromptEvent interface we rely on. The type isn't
// in lib.dom yet because the spec is still draft.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type InstallPromptOutcome = 'accepted' | 'dismissed' | 'unavailable'

export interface InstallPromptState {
  /** True when the browser has fired beforeinstallprompt and the prompt is ready. */
  available: boolean
  /** True while the native prompt is open. */
  prompting: boolean
  /**
   * Trigger the browser's install prompt. Resolves with the user's choice or
   * `'unavailable'` if no prompt event was cached (browser unsupported, prompt
   * already consumed, or app already installed).
   */
  prompt: () => Promise<InstallPromptOutcome>
}

/**
 * Hook around the `beforeinstallprompt` lifecycle. Captures the event so the
 * UI can fire the prompt on a user gesture, and clears state on `appinstalled`
 * so the install button can hide itself after install completes.
 */
export const useInstallPrompt = (): InstallPromptState => {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [prompting, setPrompting] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onBeforeInstall = (raw: Event) => {
      raw.preventDefault()
      setEvent(raw as BeforeInstallPromptEvent)
    }
    const onAppInstalled = () => {
      setEvent(null)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  const prompt = useCallback(async (): Promise<InstallPromptOutcome> => {
    if (!event) return 'unavailable'
    setPrompting(true)
    try {
      await event.prompt()
      const choice = await event.userChoice
      // Per spec, a BeforeInstallPromptEvent can only fire its prompt once.
      // Drop the reference so the button hides afterwards.
      setEvent(null)
      return choice.outcome
    } catch {
      return 'unavailable'
    } finally {
      setPrompting(false)
    }
  }, [event])

  return { available: event !== null, prompting, prompt }
}
