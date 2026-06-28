// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { ErrorBoundary } from '../../web/src/ui/ErrorBoundary.js'

const Boom = ({ explode }: { explode: boolean }) => {
  if (explode) throw new Error('kaboom')
  return <div>healthy child</div>
}

beforeEach(() => {
  // React logs caught errors to console.error; silence the noise but keep a spy.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  test('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary fallback={() => <div>fallback</div>}>
        <Boom explode={false} />
      </ErrorBoundary>
    )
    expect(screen.getByText('healthy child')).toBeInTheDocument()
    expect(screen.queryByText('fallback')).toBeNull()
  })

  test('a render throw shows the fallback instead of crashing, and logs the error', () => {
    render(
      <ErrorBoundary fallback={(error) => <div>fallback: {error.message}</div>} label="test">
        <Boom explode={true} />
      </ErrorBoundary>
    )
    expect(screen.getByText('fallback: kaboom')).toBeInTheDocument()
    expect(console.error).toHaveBeenCalled()
  })

  test('reset() lets the subtree re-render after the cause is gone', () => {
    let explode = true
    const { rerender } = render(
      <ErrorBoundary
        fallback={(_error, reset) => (
          <button onClick={reset} type="button">
            retry
          </button>
        )}
      >
        <Boom explode={explode} />
      </ErrorBoundary>
    )
    expect(screen.getByRole('button', { name: 'retry' })).toBeInTheDocument()
    // Fix the cause, then hit retry → healthy child renders again.
    explode = false
    rerender(
      <ErrorBoundary
        fallback={(_error, reset) => (
          <button onClick={reset} type="button">
            retry
          </button>
        )}
      >
        <Boom explode={explode} />
      </ErrorBoundary>
    )
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))
    expect(screen.getByText('healthy child')).toBeInTheDocument()
  })

  test('changing resetKeys auto-recovers without a manual retry (fresh good data arrives)', () => {
    const { rerender } = render(
      <ErrorBoundary fallback={() => <div>fallback</div>} resetKeys={[1]}>
        <Boom explode={true} />
      </ErrorBoundary>
    )
    expect(screen.getByText('fallback')).toBeInTheDocument()
    // New resetKey + healthy child → boundary clears its error automatically.
    rerender(
      <ErrorBoundary fallback={() => <div>fallback</div>} resetKeys={[2]}>
        <Boom explode={false} />
      </ErrorBoundary>
    )
    expect(screen.getByText('healthy child')).toBeInTheDocument()
    expect(screen.queryByText('fallback')).toBeNull()
  })
})
