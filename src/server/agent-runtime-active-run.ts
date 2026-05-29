import type { LiveAgentRun } from './agent-runtime-types.js'
import type { LiveRunRegistry } from './live-run-registry.js'

export const getActiveRunByAgent = (
  registry: LiveRunRegistry,
  getWorkspaceId: (agentId: string) => string | undefined,
  syncRun: (run: LiveAgentRun) => LiveAgentRun,
  workspaceId: string,
  agentId: string
) => {
  return registry
    .list()
    .filter((run) => run.agentId === agentId && getWorkspaceId(run.agentId) === workspaceId)
    .sort((left, right) => right.startedAt - left.startedAt)
    .find((run) => {
      // 已发起 stop 但尚未退出的 run 不算活跃，否则紧随其后的 start 会被去重成空操作（bug #7）。
      if (run.stopRequested) return false
      const status = syncRun(run).status
      return status === 'starting' || status === 'running'
    })
}
