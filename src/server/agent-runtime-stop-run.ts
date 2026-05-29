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
  } else {
    // 历史 run（DB 里有、UI 历史可见，但未加载进当前内存）：agentManager 内存里没有它，
    // getRun 会 throw 'Run not found'。对这种 run 点 Stop 应静默 no-op，绝不能冒泡成 HTTP 500（bug B1）。
    let managerStatus: string
    try {
      managerStatus = agentManager.getRun(runId).status
    } catch {
      return
    }
    if (managerStatus === 'error' || managerStatus === 'exited') {
      return
    }
  }

  agentManager.stopRun(runId)
}
