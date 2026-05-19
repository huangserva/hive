import { useEffect } from 'react'

// One-shot opt-out: when set, the next beforeunload skips the prompt and the
// flag clears. Lets background flows (service-worker auto-reload) bypass the
// always-on guard without globally disabling it.
let silentUnloadOnce = false

export const allowNextUnloadSilently = (): void => {
  silentUnloadOnce = true
}

export const __resetBeforeUnloadGuardForTests = (): void => {
  silentUnloadOnce = false
}

export const useBeforeUnloadGuard = (enabled: boolean) => {
  useEffect(() => {
    if (!enabled) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (silentUnloadOnce) {
        silentUnloadOnce = false
        return
      }
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [enabled])
}
