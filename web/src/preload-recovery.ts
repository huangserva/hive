export const registerPreloadErrorRecovery = (target: Window = window) => {
  const onPreloadError = (event: Event) => {
    event.preventDefault()
    target.location.reload()
  }
  target.addEventListener('vite:preloadError', onPreloadError)
  return () => target.removeEventListener('vite:preloadError', onPreloadError)
}
