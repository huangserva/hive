export interface FeishuRouteBinding {
  enabled: boolean
  workspaceId: string
}

export interface FeishuRouteBindingsStore {
  findByChatId: (chatId: string) => FeishuRouteBinding | null
}

export interface FeishuRouteWorkspaceStore {
  getWorkspaceSnapshot: (workspaceId: string) => unknown
}

export type FeishuRoute =
  | {
      orchestratorAgentId: string
      workspaceId: string
    }
  | {
      reason: 'no_binding' | 'workspace_missing'
    }

interface ResolveRouteInput {
  bindingsStore: FeishuRouteBindingsStore
  chatId: string
  workspaceStore: FeishuRouteWorkspaceStore
}

export const resolveRoute = ({
  bindingsStore,
  chatId,
  workspaceStore,
}: ResolveRouteInput): FeishuRoute => {
  const binding = bindingsStore.findByChatId(chatId)
  if (!binding?.enabled) return { reason: 'no_binding' }

  try {
    workspaceStore.getWorkspaceSnapshot(binding.workspaceId)
  } catch {
    return { reason: 'workspace_missing' }
  }

  return {
    orchestratorAgentId: `${binding.workspaceId}:orchestrator`,
    workspaceId: binding.workspaceId,
  }
}
