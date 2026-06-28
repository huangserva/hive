import { Component, type ErrorInfo, type ReactNode } from 'react'

// Generic React error boundary. A render-phase throw anywhere below this
// boundary is caught here instead of unmounting the whole React root (the
// white-screen bug). The boundary renders a recoverable fallback and logs the
// error for diagnosis. `resetKeys` lets a parent auto-clear the error when fresh
// (good) data arrives — e.g. the Cockpit boundary resets when a valid payload
// replaces the broken one.

interface ErrorBoundaryProps {
  children: ReactNode
  fallback: (error: Error, reset: () => void) => ReactNode
  label?: string
  resetKeys?: ReadonlyArray<unknown>
}

interface ErrorBoundaryState {
  error: Error | null
}

const sameKeys = (a?: ReadonlyArray<unknown>, b?: ReadonlyArray<unknown>): boolean => {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((value, index) => Object.is(value, b[index]))
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const tag = this.props.label ? `:${this.props.label}` : ''
    console.error(`[hive] ErrorBoundary${tag} caught a render error`, error, info.componentStack)
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    // Auto-recover when the inputs that likely caused the crash have changed
    // (e.g. a fresh, valid WS payload). Without this the user would be stuck on
    // the fallback until they hit retry, even after good data arrived.
    if (this.state.error && !sameKeys(prevProps.resetKeys, this.props.resetKeys)) {
      this.reset()
    }
  }

  reset = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) return this.props.fallback(this.state.error, this.reset)
    return this.props.children
  }
}
