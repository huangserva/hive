import type { AgentManager } from './agent-manager.js'
import type { LiveAgentRun } from './agent-runtime-types.js'
import type { LiveRunRegistry } from './live-run-registry.js'

export const stopLiveRun = (
  agentManager: AgentManager | undefined,
  registry: LiveRunRegistry,
  syncRun: (run: LiveAgentRun) => LiveAgentRun,
  runId: string
) => {
  if (!agentManager) {
    throw new Error('Agent manager is required to stop agents')
  }

  const liveRun = registry.get(runId)
  if (liveRun) {
    const status = syncRun(liveRun).status
    if (status === 'exited' || status === 'error') {
      return
    }
    // 标记 stop 已发起：在 PTY 真正退出（status 仍为 running）之前，
    // 让该 run 不再被 getActiveRunByAgent 判为活跃，从而紧随其后的 start 能正常 spawn 新 run（bug #7）。
    liveRun.stopRequested = true
  } else if (['error', 'exited'].includes(agentManager.getRun(runId).status)) {
    return
  }

  agentManager.stopRun(runId)
}
