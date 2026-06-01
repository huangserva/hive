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
  connectionMode: MobileConnectionMode
  connectionState: MobileRuntimeState
  reconnecting: boolean
  relayTransportReady: boolean
}

// P0 修复：relay-readiness 门槛**只在 relay 模式**才卡。LAN/直连模式下 relay transport 永远 not ready
// （根本没用它），发送走 readMobileJson 的 LAN 路；旧逻辑无条件 `!relayTransportReady` 会把 LAN 下每条
// prompt 误 queue 等一个永不 ready 的 relay → 永不发出（读走 LAN 通、发被拦，DB 零 inbound）。
export const shouldQueuePromptBeforeSend = ({
  connectionMode,
  connectionState,
  reconnecting,
  relayTransportReady,
}: PromptSendDecisionInput) =>
  connectionState !== 'connected' ||
  reconnecting ||
  (connectionMode === 'relay' && !relayTransportReady)

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
