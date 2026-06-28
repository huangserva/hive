// Runtime parser/validator for terminal control-socket frames. The control
// handler runs in a WS async callback — a throw there is NOT caught by any React
// ErrorBoundary (boundaries only catch render-phase errors). So a stale / malformed
// frame (e.g. snapshot is an object instead of a string) must be rejected HERE,
// before it reaches onRestore/onError/onExit and gets written into xterm / state.
// Invalid frames return null → the caller logs + drops, never touching state.

export type TerminalControlServerMessage =
  | { type: 'error'; message: string }
  | { type: 'exit'; code: number | null }
  | { type: 'restore'; snapshot: string }

export const parseTerminalControlFrame = (data: unknown): TerminalControlServerMessage | null => {
  if (typeof data !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const frame = parsed as Record<string, unknown>
  switch (frame.type) {
    case 'restore':
      return typeof frame.snapshot === 'string'
        ? { snapshot: frame.snapshot, type: 'restore' }
        : null
    case 'error':
      return typeof frame.message === 'string' ? { message: frame.message, type: 'error' } : null
    case 'exit':
      return frame.code === null || typeof frame.code === 'number'
        ? { code: frame.code as number | null, type: 'exit' }
        : null
    default:
      return null
  }
}
