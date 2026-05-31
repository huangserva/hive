import type { MobileRuntimeState } from './mobile-runtime-context'

export interface ForegroundReconnectProbeInput {
  hasToken: boolean
  isBackgrounded: boolean
  isReconnecting: boolean
  state: MobileRuntimeState
}

export const shouldProbeForegroundReconnect = ({
  hasToken,
  isBackgrounded,
  isReconnecting,
  state,
}: ForegroundReconnectProbeInput) =>
  isBackgrounded && hasToken && !isReconnecting && state === 'connected'

export interface PromptSendDecisionInput {
  connectionState: MobileRuntimeState
  reconnecting: boolean
  relayTransportReady: boolean
}

export const shouldQueuePromptBeforeSend = ({
  connectionState,
  reconnecting,
  relayTransportReady,
}: PromptSendDecisionInput) =>
  connectionState !== 'connected' || reconnecting || !relayTransportReady

export const shouldClearLoadedStateOnConnectFailure = (hasLoadedDashboard: boolean) =>
  !hasLoadedDashboard
