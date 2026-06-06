import type { ChatMessage, MobileConnectionMode } from './client'
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

// chatSince 单调推进（M 修复）：relay 推送可能送来乱序/更早的消息，取本批最大 created_at，且**仅当
// 更大才前进**——绝不让 since 倒退，否则下一轮轮询会以更早的 since 重复拉旧消息。空批不动。
export const nextChatSince = (
  current: number | undefined,
  messages: { created_at: number }[]
): number | undefined => {
  if (messages.length === 0) return current
  const maxCreatedAt = messages.reduce(
    (max, message) => (message.created_at > max ? message.created_at : max),
    current ?? 0
  )
  return current === undefined || maxCreatedAt > current ? maxCreatedAt : current
}

export interface DashboardSocketHandlerCallbacks {
  socketWorkspaceId: string
  currentWorkspaceId: () => string | null
  isClosing: () => boolean
  isConnected: () => boolean
  onChatMessage: (message: ChatMessage) => void
  onDashboard: (payload: unknown) => void
  onParseError: (message: string) => void
  onDisconnected: () => void
}

// dashboard WebSocket 三个 handler 的纯工厂（BLOCKING 修复 + 可测）：message/error/close **统一**先过
// workspace 到达时守卫——本 socket 为 socketWorkspaceId 而开，用户切走后（ref 指向别的 workspace）其事件
// 一律忽略，绝不 setDashboard / setError / setState(error) / scheduleReconnect 污染当前连接。effect cleanup
// 关旧 socket 要等下一轮渲染，与 error/close 到达之间存在窗口——故守卫必须在 handler 内部，不能只靠 cleanup。
export const createDashboardSocketHandlers = (cb: DashboardSocketHandlerCallbacks) => {
  const isStale = () => cb.currentWorkspaceId() !== cb.socketWorkspaceId
  return {
    handleMessage: (raw: string) => {
      if (isStale()) return
      try {
        const message = JSON.parse(raw) as { kind?: string; payload?: unknown }
        if (
          (message.kind === 'mobile-dashboard-snapshot' ||
            message.kind === 'mobile-dashboard-update') &&
          message.payload
        ) {
          cb.onDashboard(message.payload)
        } else if (message.kind === 'mobile-chat-message' && message.payload) {
          cb.onChatMessage(message.payload as ChatMessage)
        }
      } catch (error) {
        cb.onParseError(error instanceof Error ? error.message : String(error))
      }
    },
    handleError: () => {
      if (isStale()) return
      cb.onDisconnected()
    },
    handleClose: () => {
      if (cb.isClosing() || isStale() || !cb.isConnected()) return
      cb.onDisconnected()
    },
  }
}

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
