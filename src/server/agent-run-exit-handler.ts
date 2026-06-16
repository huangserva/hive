import type { AgentRunExitContext } from './agent-run-start-context.js'
import { completeLiveRun } from './agent-run-sync.js'

interface HandleRunExitInput {
  errorTail?: string | null
  exitCode: number | null
  endedAt: number
  runId: string
}

const clearResumedSessionOnFailure = (
  context: Pick<AgentRunExitContext, 'agentId' | 'sessionStore' | 'startConfig' | 'workspace'>,
  exitCode: number | null
) => {
  if (exitCode !== 0 && context.startConfig.resumedSessionId) {
    context.sessionStore.clearLastSessionId(context.workspace.id, context.agentId)
  }
}

export const handleAgentRunExit = (
  context: AgentRunExitContext,
  { errorTail, exitCode, endedAt, runId }: HandleRunExitInput
) => {
  context.registry.setPendingExitCode(runId, exitCode)
  const liveRun = context.registry.get(runId)
  if (!liveRun) {
    context.tokenRegistry.revokeIfMatches(context.agentId, context.token)
    return false
  }
  if (context.handledRunExits.has(runId)) {
    if (liveRun.status === 'error' && liveRun.exitCode === null && exitCode !== null) {
      liveRun.errorTail = errorTail ?? null
      completeLiveRun(liveRun, exitCode, endedAt, context.store)
      clearResumedSessionOnFailure(context, exitCode)
      context.registry.clearPendingExitCode(runId)
      return true
    }
    context.registry.clearPendingExitCode(runId)
    return false
  }

  liveRun.errorTail = errorTail ?? null
  completeLiveRun(liveRun, exitCode, endedAt, context.store)
  clearResumedSessionOnFailure(context, exitCode)
  context.handledRunExits.add(runId)
  context.tokenRegistry.revokeIfMatches(context.agentId, context.token)
  // onAgentExit 抛错也绝不能阻止 resolveExit：否则 exit promise 永不 resolve，
  // closeAgentRuntime 等它就永久挂起、close() 卡死（bug B2）。包 try/catch 保证退出收尾一定完成。
  try {
    context.onAgentExit(context.workspace.id, context.agentId)
  } catch {
    // 吞掉 onAgentExit 的异常（此处无 logger 可用）：退出收尾的可靠性优先于上抛该错误。
  }
  context.registry.resolveExit(runId)
  context.registry.clearPendingExitCode(runId)
  return true
}
