import type { MobileConnectionMode } from '../api/client'

export type ConnectionModeBannerMode = MobileConnectionMode | 'disconnected'
export type ConnectionModeBannerRuntimeState = 'idle' | 'checking' | 'connected' | 'error'

export interface ConnectionModeBannerSnapshot {
  displayMode: ConnectionModeBannerMode
  showConnecting: boolean
}

export const getConnectionModeBannerSnapshot = ({
  connectionMode,
  reconnecting,
  state,
}: {
  connectionMode: MobileConnectionMode
  reconnecting: boolean
  state: ConnectionModeBannerRuntimeState
}): ConnectionModeBannerSnapshot => {
  const showConnecting = state === 'checking' || reconnecting
  return {
    displayMode: state === 'connected' && !reconnecting ? connectionMode : 'disconnected',
    showConnecting,
  }
}
