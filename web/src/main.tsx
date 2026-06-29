import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles/globals.css'
import { App } from './app.js'
import { registerPreloadErrorRecovery } from './preload-recovery.js'
import { ErrorBoundary } from './ui/ErrorBoundary.js'
import { AppErrorFallback } from './ui/ErrorFallback.js'

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
