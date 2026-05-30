import type { ChatMessage } from './client'
import type { RelayTransportEvent } from './relay-transport'

// 把 relay 服务器推送事件（M27 Part B）映射成"该对 state 做什么"的纯决策，便于单测，
// 也让 context 的事件处理器保持精简（仍走 ref 最新闭包，不引入 client useMemo 依赖）。
export interface RelayEventActions {
  // dashboard_update → bump，让 cockpit 各标签页（plan/tasks/questions/ideas/actions）
  // 依 syncRevision 变化重新 getCockpit，整个 Cockpit 跟着 .hive 变更实时刷新。
  bumpSyncRevision: boolean
  // chat_message → 直接 merge 这条消息（store 消息字段是 mobile ChatMessage 超集，安全）。
  mergeChatMessage: ChatMessage | null
  // dashboard_update → 刷新首页 dashboard 的 workspace id。
  refreshDashboardWorkspaceId: string | null
}

const NONE: RelayEventActions = {
  bumpSyncRevision: false,
  mergeChatMessage: null,
  refreshDashboardWorkspaceId: null,
}

export const resolveRelayEventActions = (
  event: RelayTransportEvent,
  currentWorkspaceId: string | null
): RelayEventActions => {
  if (event.kind === 'chat_message') {
    const data = event.payload as { message?: ChatMessage; workspace_id?: string }
    if (data?.message?.id && data.workspace_id === currentWorkspaceId) {
      return { ...NONE, mergeChatMessage: data.message }
    }
    return NONE
  }
  if (event.kind === 'dashboard_update') {
    const data = event.payload as { workspace_id?: string }
    if (data?.workspace_id && data.workspace_id === currentWorkspaceId) {
      return { ...NONE, bumpSyncRevision: true, refreshDashboardWorkspaceId: data.workspace_id }
    }
    return NONE
  }
  return NONE
}
