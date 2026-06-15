import { join } from 'node:path'

import type { AgentSummary, WorkspaceSummary } from '../shared/types.js'
import { createAgentLaunchCache } from './agent-launch-cache.js'
import { resolveAgentLaunchRoots } from './agent-launch-roots.js'
import type { AgentManager } from './agent-manager.js'
import { createAgentRunStarter } from './agent-run-starter.js'
import { syncPersistedRun } from './agent-run-sync.js'
import { getActiveRunByAgent } from './agent-runtime-active-run.js'
import { closeAgentRuntime } from './agent-runtime-close.js'
import type { AgentRuntime } from './agent-runtime-contract.js'
import { createAgentRuntimeFlowAdapter } from './agent-runtime-flow-adapter.js'
import { listRunsWithFallback } from './agent-runtime-list-runs.js'
import type { AgentRunStorePort, AgentSessionStorePort } from './agent-runtime-ports.js'
import { stopLiveRun } from './agent-runtime-stop-run.js'
import type { LiveAgentRun } from './agent-runtime-types.js'
import { createAgentStdinDispatcher } from './agent-stdin-dispatcher.js'
import { createAgentTokenRegistry } from './agent-tokens.js'
import {
  getCommandPresetCapabilities,
  summarizeCommandPresetCapabilities,
} from './command-preset-capabilities.js'
import type { CommandPresetRecord } from './command-preset-store.js'
import { createLiveRunRegistry } from './live-run-registry.js'
import type { HiveLogger } from './logger.js'
import { createNoopRestartPolicy, type RestartPolicy } from './restart-policy.js'
import { createWorktreeManager } from './worktree-manager.js'

export const createAgentRuntime = (
  agentManager: AgentManager | undefined,
  agentRunStore: AgentRunStorePort,
  sessionStore: AgentSessionStorePort,
  getCommandPreset: (id: string) => CommandPresetRecord | undefined,
  onAgentExit: (workspaceId: string, agentId: string) => void,
  restartPolicy: RestartPolicy = createNoopRestartPolicy(),
  getAgent?: (workspaceId: string, agentId: string) => AgentSummary | undefined,
  logger?: HiveLogger,
  // M25 Phase 1：runtime state 目录；codex agent 据此获得物理隔离的 managed CODEX_HOME。
  dataDir?: string,
  listAgents?: (workspaceId: string) => readonly AgentSummary[]
): AgentRuntime => {
  const registry = createLiveRunRegistry()
  const launchCache = createAgentLaunchCache(agentRunStore)
  const tokenRegistry = createAgentTokenRegistry()
  const startPromises = new Map<string, Promise<LiveAgentRun>>()
  let closing = false
  const requireManager = () => {
    if (!agentManager) throw new Error('Agent manager is required for PTY terminal operations')
    return agentManager
  }
  const flowAdapter = createAgentRuntimeFlowAdapter(requireManager)

  // M32 Phase 1：worker CODE worktree 分层，默认关闭（HIVE_WORKER_WORKTREES=1 显式开启）。
  // 关闭时 resolveLaunchRoots 三根全退回 workspace.path —— 与现有 PTY cwd 行为完全一致（向后兼容）。
  const workerWorktreesEnabled = process.env.HIVE_WORKER_WORKTREES === '1' && Boolean(dataDir)
  const worktreeManager = workerWorktreesEnabled ? createWorktreeManager() : undefined
  const resolveLaunchRoots =
    worktreeManager && dataDir
      ? (workspace: WorkspaceSummary, agentId: string) =>
          resolveAgentLaunchRoots(workspace, agentId, {
            ensureWorkerWorktree: worktreeManager.ensureWorkerWorktree,
            worktreesRoot: join(dataDir, 'worktrees'),
          })
      : undefined

  const syncRun = (run: LiveAgentRun) =>
    agentManager ? syncPersistedRun(run, agentManager.getRun(run.runId), agentRunStore) : run
  const stdinDispatcher = createAgentStdinDispatcher({
    agentManager,
    getLaunchConfig: launchCache.peek,
    ...(listAgents ? { listAgents } : {}),
    getWorkspaceId: launchCache.getWorkspaceId,
    registry,
    syncRun,
  })
  const startLiveRun = createAgentRunStarter({
    agentManager,
    registry,
    onAgentExit,
    store: agentRunStore,
    sessionStore,
    tokenRegistry,
    getCommandPreset,
    getAgent,
    logger,
    restartPolicy,
    dataDir,
    resolveLaunchRoots,
  })

  return {
    async close() {
      closing = true
      await Promise.allSettled([...startPromises.values()])
      await closeAgentRuntime(agentManager, registry, syncRun)
    },
    configureAgentLaunch(workspaceId, agentId, input) {
      launchCache.save(workspaceId, agentId, input)
    },
    deleteAgentLaunchConfig(workspaceId, agentId) {
      launchCache.remove(workspaceId, agentId)
    },
    peekAgentLaunchConfig(workspaceId, agentId) {
      return launchCache.peek(workspaceId, agentId)
    },
    getActiveRunByAgentId(workspaceId, agentId) {
      return getActiveRunByAgent(
        registry,
        launchCache.getWorkspaceId,
        syncRun,
        workspaceId,
        agentId
      )
    },
    getLiveRun(runId) {
      const run = registry.get(runId)
      if (!run) throw new Error(`Live run not found: ${runId}`)
      return syncRun(run)
    },
    getPtyOutputBus() {
      return flowAdapter.getOutputBus()
    },
    listAgentRuns(agentId) {
      return listRunsWithFallback(registry, agentRunStore.listAgentRuns(agentId), agentId)
    },
    pauseRun(runId) {
      flowAdapter.pauseRun(runId)
    },
    peekAgentToken(agentId) {
      return tokenRegistry.peek(agentId)
    },
    resizeAgentRun(runId, cols, rows) {
      flowAdapter.resizeRun(runId, cols, rows)
    },
    resumeRun(runId) {
      flowAdapter.resumeRun(runId)
    },
    async startAgent(workspace, agentId, input) {
      if (closing) throw new Error('Agent runtime is closing')
      launchCache.setWorkspaceId(agentId, workspace.id)
      const key = `${workspace.id}:${agentId}`
      const activeRun = getActiveRunByAgent(
        registry,
        launchCache.getWorkspaceId,
        syncRun,
        workspace.id,
        agentId
      )
      if (activeRun) return activeRun
      const pendingStart = startPromises.get(key)
      if (pendingStart) return pendingStart
      const startPromise = startLiveRun(
        workspace,
        agentId,
        launchCache.get(workspace.id, agentId),
        input.hivePort
      ).finally(() => {
        if (startPromises.get(key) === startPromise) {
          startPromises.delete(key)
        }
      })
      startPromises.set(key, startPromise)
      return startPromise
    },
    stopAgentRun(runId) {
      stopLiveRun(agentManager, registry, syncRun, runId)
    },
    validateAgentToken: tokenRegistry.validate,
    writeReportPrompt(workspaceId, workerName, _workerId, text, artifacts, input = {}) {
      stdinDispatcher.writeReportPrompt(workspaceId, workerName, text, artifacts, input)
    },
    writeStatusPrompt(workspaceId, workerName, _workerId, text, artifacts, input = {}) {
      stdinDispatcher.writeStatusPrompt(workspaceId, workerName, text, artifacts, input)
    },
    writeQuestionAnsweredPrompt(workspaceId, questionId, answer, input = {}) {
      stdinDispatcher.writeQuestionAnsweredPrompt(workspaceId, questionId, answer, input)
    },
    writeTasksNarrativeNudgePrompt(workspaceId, message, input = {}) {
      stdinDispatcher.writeTasksNarrativeNudgePrompt(workspaceId, message, input)
    },
    writeSendPrompt(
      workspaceId,
      workerId,
      dispatchId,
      fromAgentName,
      workerDescription,
      text,
      cockpitSnapshot,
      input = {}
    ) {
      const launchConfig = launchCache.peek(workspaceId, workerId)
      const presetId =
        launchConfig && !launchConfig.presetAugmentationDisabled
          ? (launchConfig.commandPresetId ?? getCommandPreset(launchConfig.command)?.id ?? null)
          : null
      const preset = presetId ? getCommandPreset(presetId) : undefined
      const capabilitySummary = preset
        ? summarizeCommandPresetCapabilities(
            preset.displayName,
            getCommandPresetCapabilities(preset.id)
          )
        : undefined
      stdinDispatcher.writeSendPrompt(
        workspaceId,
        workerId,
        dispatchId,
        fromAgentName,
        workerDescription,
        text,
        cockpitSnapshot,
        capabilitySummary,
        input
      )
    },
    writeCancelPrompt(workspaceId, workerId, dispatchId, reason, input = {}) {
      stdinDispatcher.writeCancelPrompt(workspaceId, workerId, dispatchId, reason, input)
    },
    writeUserInputPrompt(workspaceId, text) {
      stdinDispatcher.writeUserInputPrompt(workspaceId, text)
    },
  }
}

export type { AgentRuntime }
