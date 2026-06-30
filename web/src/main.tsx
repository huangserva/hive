import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles/globals.css'
import { App } from './app.js'
import { registerPreloadErrorRecovery } from './preload-recovery.js'
import { ErrorBoundary } from './ui/ErrorBoundary.js'
import { AppErrorFallback } from './ui/ErrorFallback.js'

window.addEventListener('error', (event) => {
  console.error('[hive] window error', {
    colno: event.colno,
    filename: event.filename,
    lineno: event.lineno,
    message: event.message,
    stack: event.error instanceof Error ? event.error.stack : undefined,
  })
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  console.error('[hive] unhandled rejection', {
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  })
})

const container = document.getElementById('root')

if (!container) {
  throw new Error('Root element not found')
}

registerPreloadErrorRecovery()

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary fallback={(error, reset) => <AppErrorFallback error={error} reset={reset} />}>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
