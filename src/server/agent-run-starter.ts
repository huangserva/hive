import type { AgentSummary, WorkspaceSummary } from '../shared/types.js'
import type { AgentManager } from './agent-manager.js'
import { buildAgentRunBootstrap, startAgentRunCapture } from './agent-run-bootstrap.js'
import { handleAgentRunExit } from './agent-run-exit-handler.js'
import type { AgentRunExitContext, AgentRunStarterStorePort } from './agent-run-start-context.js'
import type { AgentLaunchConfigInput } from './agent-run-store.js'
import type { AgentSessionStorePort } from './agent-runtime-ports.js'
import type { LiveAgentRun } from './agent-runtime-types.js'
import { buildAgentStartupInstructions } from './agent-startup-instructions.js'
import type { AgentTokenRegistry } from './agent-tokens.js'
import type { CommandPresetRecord } from './command-preset-store.js'
import type { LiveRunRegistry } from './live-run-registry.js'
import type { HiveLogger } from './logger.js'
import { createPostStartInputWriter, isInteractiveAgentCommand } from './post-start-input-writer.js'
import type { RestartPolicy } from './restart-policy.js'
import {
  appendSessionStartReviewMessage,
  SESSION_START_REVIEW_MESSAGE,
} from './session-start-review-message.js'

interface AgentRunStarterInput {
  agentManager: AgentManager | undefined
  registry: LiveRunRegistry
  onAgentExit: (workspaceId: string, agentId: string) => void
  store: AgentRunStarterStorePort
  sessionStore: AgentSessionStorePort
  tokenRegistry: AgentTokenRegistry
  getCommandPreset: (id: string) => CommandPresetRecord | undefined
  getAgent: ((workspaceId: string, agentId: string) => AgentSummary | undefined) | undefined
  logger?: HiveLogger | undefined
  restartPolicy: RestartPolicy
}

export const createAgentRunStarter = ({
  agentManager,
  registry,
  onAgentExit,
  store,
  sessionStore,
  tokenRegistry,
  getCommandPreset,
  getAgent,
  logger,
  restartPolicy,
}: AgentRunStarterInput) => {
  const agentsWithSessionStartReview = new Set<string>()
  const takeSessionStartReviewMessage = (agentId: string) => {
    if (!agentId.endsWith(':orchestrator')) return null
    if (agentsWithSessionStartReview.has(agentId)) return null
    agentsWithSessionStartReview.add(agentId)
    return SESSION_START_REVIEW_MESSAGE
  }

  return async (
    workspace: WorkspaceSummary,
    agentId: string,
    config: AgentLaunchConfigInput,
    hivePort: string
  ) => {
    if (!agentManager) throw new Error('Agent manager is required to start agents')

    const agent = getAgent?.(workspace.id, agentId)
    const { sessionCaptureSnapshot, startConfig, startEnv } = buildAgentRunBootstrap(
      workspace,
      agentId,
      config,
      sessionStore,
      getCommandPreset,
      agent
    )
    const handledRunExits = new Set<string>()
    const abortedRunIds = new Set<string>()
    const startedAt = Date.now()
    const token = tokenRegistry.issue(agentId)
    const exitContext: AgentRunExitContext = {
      agentId,
      handledRunExits,
      onAgentExit,
      registry,
      sessionStore,
      startConfig,
      store,
      token,
      tokenRegistry,
      workspace,
    }
    const startInput = {
      agentId,
      command: startConfig.command,
      cwd: workspace.path,
      env: {
        ...startEnv,
        COLORTERM: 'truecolor',
        FORCE_COLOR: '1',
        NO_COLOR: undefined,
        TERM: 'xterm-256color',
        TERM_PROGRAM: 'hive',
        HIVE_PORT: hivePort,
        HIVE_AGENT_TOKEN: token,
      },
      onExit: ({
        runId,
        exitCode,
        errorTail,
      }: {
        runId: string
        exitCode: number | null
        errorTail?: string | null
      }) => {
        const endedAt = Date.now()
        if (exitCode !== 0 && errorTail) {
          logger?.error(
            `agent run error workspace=${workspace.id} agent=${agentId} run=${runId} exit_code=${exitCode}`,
            errorTail
          )
        }
        if (
          !handleAgentRunExit(exitContext, {
            errorTail: errorTail ?? null,
            exitCode,
            endedAt,
            runId,
          }) &&
          abortedRunIds.has(runId)
        ) {
          registry.clearPendingExitCode(runId)
          return
        }
      },
    }

    let run: Awaited<ReturnType<AgentManager['startAgent']>>
    try {
      run = await agentManager.startAgent(
        startConfig.args ? { ...startInput, args: startConfig.args } : startInput
      )
    } catch (error) {
      tokenRegistry.revokeIfMatches(agentId, token)
      throw error
    }
    const liveRun: LiveAgentRun = {
      ...run,
      exitCode: run.status === 'error' ? run.exitCode : null,
      startedAt,
      status: run.status === 'error' ? 'error' : 'starting',
    }
    try {
      store.insertAgentRun(run.runId, agentId, startedAt, run.pid, liveRun.status, liveRun.exitCode)
    } catch (error) {
      abortedRunIds.add(run.runId)
      registry.clearPendingExitCode(run.runId)
      tokenRegistry.revokeIfMatches(agentId, token)
      agentManager.stopRun(run.runId)
      throw error
    }
    registry.createExitEntry(run.runId)
    registry.add(liveRun)

    if (run.status === 'error') {
      store.updatePersistedRun(run.runId, 'error', run.exitCode, Date.now(), run.errorTail)
      if (startConfig.resumedSessionId) {
        sessionStore.clearLastSessionId(workspace.id, agentId)
      }
      tokenRegistry.revokeIfMatches(agentId, token)
      // Ensure §12 three-state: failed spawn must flip AgentSummary to stopped.
      onAgentExit(workspace.id, agentId)
      registry.resolveExit(run.runId)
      registry.clearPendingExitCode(run.runId)
      return liveRun
    }

    startAgentRunCapture({ agentId, sessionCaptureSnapshot, sessionStore, startConfig, workspace })
    const postStartWriter = createPostStartInputWriter(
      agentManager,
      startConfig.interactiveCommand ?? startConfig.command
    )
    queueMicrotask(() => {
      try {
        const sessionStartReviewMessage = takeSessionStartReviewMessage(agentId)
        const writeWithSessionStartReview = (runId: string, text: string) => {
          postStartWriter(
            runId,
            sessionStartReviewMessage ? appendSessionStartReviewMessage(text) : text
          )
        }
        const injectedRestartMessage = restartPolicy.injectPostStartMessage({
          agentId,
          runId: run.runId,
          startConfig,
          workspace,
          writeToRun: writeWithSessionStartReview,
        })
        if (startConfig.resumedSessionId && sessionStartReviewMessage) {
          postStartWriter(run.runId, sessionStartReviewMessage)
          return
        }
        if (
          !startConfig.resumedSessionId &&
          !injectedRestartMessage &&
          agent &&
          isInteractiveAgentCommand(startConfig.interactiveCommand ?? startConfig.command)
        ) {
          postStartWriter(
            run.runId,
            sessionStartReviewMessage
              ? appendSessionStartReviewMessage(buildAgentStartupInstructions({ agent, workspace }))
              : buildAgentStartupInstructions({ agent, workspace })
          )
        }
      } catch {
        // The agent may have exited before post-start guidance could be written.
      }
    })

    if (registry.hasPendingExitCode(run.runId)) {
      const exitCode = registry.getPendingExitCode(run.runId) ?? null
      queueMicrotask(() => {
        handleAgentRunExit(exitContext, {
          errorTail: run.errorTail ?? null,
          exitCode,
          endedAt: Date.now(),
          runId: run.runId,
        })
      })
    }

    return liveRun
  }
}
