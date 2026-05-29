export const RECONNECT_BASE_DELAY_MS = 3000
export const RECONNECT_MAX_DELAY_MS = 30_000
type ReconnectRuntimeState = 'idle' | 'checking' | 'connected' | 'error'

export const nextReconnectDelayMs = (
  failureCount: number,
  baseDelayMs = RECONNECT_BASE_DELAY_MS,
  maxDelayMs = RECONNECT_MAX_DELAY_MS
) => Math.min(baseDelayMs * 2 ** Math.max(0, failureCount), maxDelayMs)

export const shouldAttemptAutoReconnect = ({
  demoMode,
  hasToken,
  inFlight,
  state,
}: {
  demoMode: boolean
  hasToken: boolean
  inFlight: boolean
  state: ReconnectRuntimeState
}) => !demoMode && hasToken && !inFlight && state !== 'connected' && state !== 'checking'
