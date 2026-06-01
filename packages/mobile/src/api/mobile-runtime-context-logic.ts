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

export interface OutboxFlushDecisionInput {
  connectionMode: MobileConnectionMode
  connectionState: MobileRuntimeState
  reconnecting: boolean
  queuedCount: number
  relayTransportReady: boolean
}

// dispatch 8855a45c 修复3：flush 队列前的门槛。relay 模式下若 relay transport 还没 ready（churn/重连
// 中途），**不要 flush**——否则 flush 的 RPC 会撞超时、再喂 churn，且白白把消息标 failed。relay 转 ready
// 后此判定翻 true，effect 重跑即补发卡住的队列（连带修 #4）。门槛与 shouldQueuePromptBeforeSend 对齐：
// relay-readiness 只对 relay 模式生效，lan/直连不受影响。
export const shouldFlushQueuedOutbox = ({
  connectionMode,
  connectionState,
  reconnecting,
  queuedCount,
  relayTransportReady,
}: OutboxFlushDecisionInput) =>
  connectionState === 'connected' &&
  !reconnecting &&
  queuedCount > 0 &&
  !(connectionMode === 'relay' && !relayTransportReady)

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
