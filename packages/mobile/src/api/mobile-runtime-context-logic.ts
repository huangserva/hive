import type { MobileConnectionMode } from './client'
import type { MobileRuntimeState } from './mobile-runtime-context'

export type ConnectionPreference = 'auto' | 'lan' | 'relay'

export interface ForegroundReconnectProbeInput {
  preferredConnectionMode: ConnectionPreference
  hasToken: boolean
  isBackgrounded: boolean
  isReconnecting: boolean
  connectionMode: MobileConnectionMode
  state: MobileRuntimeState
}

export const shouldProbeForegroundReconnect = ({
  hasToken,
  isBackgrounded,
  isReconnecting,
  state,
}: ForegroundReconnectProbeInput) =>
  isBackgrounded && hasToken && !isReconnecting && state === 'connected'

export const shouldResetLanCooldownBeforeForegroundProbe = ({
  connectionMode,
  hasToken,
  isBackgrounded,
  preferredConnectionMode,
  isReconnecting,
  state,
}: ForegroundReconnectProbeInput) =>
  shouldProbeForegroundReconnect({
    connectionMode,
    hasToken,
    isBackgrounded,
    preferredConnectionMode,
    isReconnecting,
    state,
  }) &&
  preferredConnectionMode !== 'relay' &&
  connectionMode === 'relay'

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

export interface ChatWorkspaceSwitchInput {
  currentWorkspaceId: string | null
  nextWorkspaceId: string | null
}

export const shouldResetChatForWorkspaceSwitch = ({
  currentWorkspaceId,
  nextWorkspaceId,
}: ChatWorkspaceSwitchInput) => currentWorkspaceId !== nextWorkspaceId

export interface ChatConnectionSwitchInput {
  currentHost: string
  currentToken: string
  nextHost: string
  nextToken: string
}

export const shouldResetChatForConnectionSwitch = ({
  currentHost,
  currentToken,
  nextHost,
  nextToken,
}: ChatConnectionSwitchInput) => currentHost !== nextHost || currentToken !== nextToken

export interface ChatDisconnectReset {
  chatSince: number | undefined
  selectedWorkspaceId: string | null
  shouldClearMessages: boolean
}

export const resetChatRuntimeForDisconnect = (): ChatDisconnectReset => ({
  chatSince: undefined,
  selectedWorkspaceId: null,
  shouldClearMessages: true,
})

export interface ChatWorkspaceApplyInput {
  currentWorkspaceId: string | null
  requestedWorkspaceId: string
}

export const shouldApplyChatMessagesForWorkspace = ({
  currentWorkspaceId,
  requestedWorkspaceId,
}: ChatWorkspaceApplyInput) => currentWorkspaceId === requestedWorkspaceId
