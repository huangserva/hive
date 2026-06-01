import type { AgentManager } from './agent-manager.js'
import { type AgentLaunchConfigInput, createAgentRunStore } from './agent-run-store.js'
import { createAgentRunTimelineStore } from './agent-run-timeline-store.js'
import { createAgentRuntime } from './agent-runtime.js'
import type { LiveAgentRun } from './agent-runtime-types.js'
import { createAgentSessionStore } from './agent-session-store.js'
import { createDispatchLedgerStore } from './dispatch-ledger-store.js'
import { createApprovalLedger } from './feishu-approval-ledger.js'
import { createFeishuBindingsStore } from './feishu-bindings-store.js'
import type { HiveLogger } from './logger.js'
import { createMessageLogStore } from './message-log-store.js'
import { createMilestoneCompletionTrigger } from './milestone-completion-trigger.js'
import { createMobileAuthStore } from './mobile-auth.js'
import {
  createMobileChatStore,
  type MobileChatDirection,
  type MobileChatMessage,
  type MobileChatMessageType,
} from './mobile-chat-store.js'
import { createMobileOrchestratorReplyCapture } from './mobile-orchestrator-reply-capture.js'
import { createMobilePushService } from './mobile-push.js'
import { seedOrchestratorLaunchConfig } from './orchestrator-launch.js'
import { notifyOrphanedDispatchesOnWorkerExit } from './orphaned-dispatch-nudge.js'
import { createPostStartInputWriter } from './post-start-input-writer.js'
import type { PtyOutputBus } from './pty-output-bus.js'
import { openRuntimeDatabase } from './runtime-database.js'
import { buildRuntimeRestartPolicy } from './runtime-restart-policy.js'
import { createSentinelHeartbeat } from './sentinel-heartbeat.js'
import { createSettingsStore } from './settings-store.js'
import { createStalledDispatchNudge } from './stalled-dispatch-nudge.js'
import { createTasksFileService } from './tasks-file.js'
import { createTasksFileWatcher } from './tasks-file-watcher.js'
import { createTeamOperations } from './team-operations.js'
import { resolveTerminalInputProfile } from './terminal-input-profile.js'
import { createUiAuth } from './ui-auth.js'
import { summarizeUnreviewedCodeDispatches } from './unreviewed-code-status.js'
import { createWorkerOutputTracker, type WorkerOutputTracker } from './worker-output-tracker.js'
import { createWorkspaceShellRuntime } from './workspace-shell-runtime.js'
import { createWorkspaceStore } from './workspace-store.js'

export interface RuntimeStoreServices {
  agentRunStore: ReturnType<typeof createAgentRunStore>
  agentRunTimelineStore: ReturnType<typeof createAgentRunTimelineStore>
  agentRuntime: ReturnType<typeof createAgentRuntime>
  approvalLedger: ReturnType<typeof createApprovalLedger>
  db: ReturnType<typeof openRuntimeDatabase>
  dispatchLedgerStore: ReturnType<typeof createDispatchLedgerStore>
  feishuBindingsStore: ReturnType<typeof createFeishuBindingsStore>
  messageLogStore: ReturnType<typeof createMessageLogStore>
  mobileAuthStore: ReturnType<typeof createMobileAuthStore>
  mobileChatStore: ReturnType<typeof createMobileChatStore>
  mobileChatWatchCallbacks: Set<(workspaceId: string, message: MobileChatMessage) => void>
  mobileOrchestratorReplyCapture: ReturnType<typeof createMobileOrchestratorReplyCapture> | null
  mobilePushService: ReturnType<typeof createMobilePushService>
  cockpitFileWatchCallbacks: Set<(workspaceId: string) => void>
  settings: ReturnType<typeof createSettingsStore>
  shellRuntime: ReturnType<typeof createWorkspaceShellRuntime>
  planFileWatchCallbacks: Set<(workspaceId: string, content: string) => void>
  sentinelHeartbeat: ReturnType<typeof createSentinelHeartbeat> | null
  stalledDispatchNudge: ReturnType<typeof createStalledDispatchNudge>
  tasksFileWatcher: ReturnType<typeof createTasksFileWatcher>
  tasksFileWatchCallbacks: Set<(workspaceId: string, content: string) => void>
  tasksFileService: ReturnType<typeof createTasksFileService>
  teamOps: ReturnType<typeof createTeamOperations>
  uiAuth: ReturnType<typeof createUiAuth>
  workerOutputTracker: WorkerOutputTracker | null
  workspaceStore: ReturnType<typeof createWorkspaceStore>
}

interface CreateRuntimeStoreServicesOptions {
  agentManager?: AgentManager
  dataDir?: string
  logger?: HiveLogger
}

interface CreateRuntimeStoreLifecycleOptions {
  agentManager?: AgentManager
  services: RuntimeStoreServices
}

const notifyTasksUpdated = (
  callbacks: Set<(workspaceId: string, content: string) => void>,
  workspaceId: string,
  content: string
) => {
  for (const callback of callbacks) {
    callback(workspaceId, content)
  }
}

export const createRuntimeStoreServices = (
  options: CreateRuntimeStoreServicesOptions = {}
): RuntimeStoreServices => {
  const db = openRuntimeDatabase(options.dataDir)
  const messageLogStore = createMessageLogStore(db)
  const mobileAuthStore = createMobileAuthStore(db)
  const mobileChatStore = createMobileChatStore(db)
  const mobileChatWatchCallbacks = new Set<
    (workspaceId: string, message: MobileChatMessage) => void
  >()
  const insertMobileChatMessage = (
    workspaceId: string,
    direction: MobileChatDirection,
    messageType: MobileChatMessageType,
    contentJson: string
  ) => {
    const message = mobileChatStore.insertChatMessage(
      workspaceId,
      direction,
      messageType,
      contentJson
    )
    for (const callback of mobileChatWatchCallbacks) callback(workspaceId, message)
    return message
  }
  const mobilePushService = createMobilePushService({
    store: {
      clearMobilePushToken: (pushToken) => mobileAuthStore.clearPushToken(pushToken),
      listMobileDevices: () => mobileAuthStore.listDevices(),
    },
  })
  const dispatchLedgerStore = createDispatchLedgerStore(db)
  const approvalLedger = createApprovalLedger()
  const feishuBindingsStore = createFeishuBindingsStore(db)
  const agentRunStore = createAgentRunStore(db)
  const agentRunTimelineStore = createAgentRunTimelineStore(db)
  const agentSessionStore = createAgentSessionStore(db)
  const settings = createSettingsStore(db)
  const tasksFileService = createTasksFileService(
    options.logger ? { logger: options.logger } : undefined
  )
  const cockpitFileWatchCallbacks = new Set<(workspaceId: string) => void>()
  const planFileWatchCallbacks = new Set<(workspaceId: string, content: string) => void>()
  const tasksFileWatchCallbacks = new Set<(workspaceId: string, content: string) => void>()
  const tasksFileWatcher = createTasksFileWatcher({
    onCockpitUpdated: (workspaceId) => {
      for (const callback of cockpitFileWatchCallbacks) callback(workspaceId)
    },
    onPlanUpdated: (workspaceId, content) => {
      notifyTasksUpdated(planFileWatchCallbacks, workspaceId, content)
    },
    onTasksUpdated: (workspaceId, content) => {
      notifyTasksUpdated(tasksFileWatchCallbacks, workspaceId, content)
    },
  })
  const uiAuth = createUiAuth()
  const shellRuntime = createWorkspaceShellRuntime(options.agentManager)

  agentRunStore.markUnfinishedRunsStale()

  const workspaceStore = createWorkspaceStore(db, dispatchLedgerStore.listOpenDispatchKinds())
  const startExistingWorkspaceWatches = () => {
    for (const workspace of workspaceStore.listWorkspaces()) {
      void tasksFileWatcher.start(workspace.id, workspace.path)
    }
  }
  const restartPolicy = buildRuntimeRestartPolicy({
    agentRunStore,
    listDispatches: dispatchLedgerStore.listWorkspaceDispatches,
    messageLogStore,
    tasksFileService,
    workspaceStore,
  })
  const workerOutputTracker = options.agentManager
    ? createWorkerOutputTracker(options.agentManager.getOutputBus())
    : null
  const mobileOrchestratorReplyCapture = options.agentManager
    ? createMobileOrchestratorReplyCapture({
        insertMobileChatMessage,
        outputBus: options.agentManager.getOutputBus(),
      })
    : null
  const agentRuntime = createAgentRuntime(
    options.agentManager,
    agentRunStore,
    agentSessionStore,
    settings.getCommandPreset,
    (workspaceId, agentId) => {
      mobileOrchestratorReplyCapture?.detach(workspaceId, agentId)
      workerOutputTracker?.detach(workspaceId, agentId)
      if (!workspaceStore.hasAgent(workspaceId, agentId)) return
      const worker = workspaceStore.getAgent(workspaceId, agentId)
      workspaceStore.markAgentStopped(workspaceId, agentId)
      try {
        notifyOrphanedDispatchesOnWorkerExit({
          injectNudge: (targetWorkspaceId, message) =>
            agentRuntime.writeTasksNarrativeNudgePrompt(targetWorkspaceId, message),
          listOpenDispatchesForWorker: dispatchLedgerStore.listOpenDispatchesForWorker,
          worker,
          workspaceId,
        })
      } catch (error) {
        options.logger?.warn(
          `orphaned dispatch nudge failed workspace_id=${workspaceId} agent_id=${agentId}`,
          error
        )
      }
    },
    restartPolicy,
    (workspaceId, agentId) => workspaceStore.getAgent(workspaceId, agentId),
    options.logger,
    options.dataDir
  )
  const milestoneCompletionTrigger = createMilestoneCompletionTrigger({
    getWorkspacePath: (workspaceId) =>
      workspaceStore.getWorkspaceSnapshot(workspaceId).summary.path,
    injectNudge: (workspaceId, message) =>
      agentRuntime.writeTasksNarrativeNudgePrompt(workspaceId, message),
  })
  planFileWatchCallbacks.add((workspaceId, content) => {
    milestoneCompletionTrigger.handlePlanUpdated(workspaceId, content)
  })
  const writeAgentRunInput = (runId: string, input: string) => {
    const activeAgent = workspaceStore
      .listWorkspaces()
      .flatMap((workspace) =>
        workspaceStore
          .getWorkspaceSnapshot(workspace.id)
          .agents.map((agent) => ({ agent, workspaceId: workspace.id }))
      )
      .find(
        ({ agent, workspaceId }) =>
          agentRuntime.getActiveRunByAgentId(workspaceId, agent.id)?.runId === runId
      )
    const config = activeAgent
      ? agentRuntime.peekAgentLaunchConfig(activeAgent.workspaceId, activeAgent.agent.id)
      : undefined
    if (options.agentManager && config) {
      createPostStartInputWriter(options.agentManager, config.interactiveCommand ?? config.command)(
        runId,
        input
      )
      return
    }
    options.agentManager?.writeInput(runId, input)
  }
  const sentinelHeartbeat = options.agentManager
    ? createSentinelHeartbeat({
        getActiveRunByAgentId: (workspaceId, agentId) =>
          agentRuntime.getActiveRunByAgentId(workspaceId, agentId),
        getWorkerConfig: (workspaceId, workerId) =>
          workspaceStore.getWorkerConfig(workspaceId, workerId),
        listOpenDispatches: (workspaceId) =>
          dispatchLedgerStore.listOpenDispatchesForWorkspace(workspaceId),
        listWorkers: (workspaceId) => workspaceStore.listWorkers(workspaceId),
        listWorkspaces: () => workspaceStore.listWorkspaces(),
        ...(options.logger ? { logger: options.logger } : {}),
        writeRunInput: writeAgentRunInput,
      })
    : null
  // Fix B 兜底：周期巡检「活着但卡住」的 submitted dispatch，nudge orchestrator 核实/重投。
  const stalledDispatchNudge = createStalledDispatchNudge({
    getActiveRunByAgentId: (workspaceId, agentId) =>
      agentRuntime.getActiveRunByAgentId(workspaceId, agentId),
    injectNudge: (workspaceId, message) =>
      agentRuntime.writeTasksNarrativeNudgePrompt(workspaceId, message),
    listOpenDispatchesForWorkspace: (workspaceId) =>
      dispatchLedgerStore.listOpenDispatchesForWorkspace(workspaceId),
    listWorkspaces: () => workspaceStore.listWorkspaces(),
    // 派单超时未汇报 → 直接 surface 给 user（除 LLM nudge 外的硬兜底，绝不静默）。
    notifyUserOfStaleDispatch: (workspaceId, dispatch, notice) => {
      let workerName = dispatch.toAgentId
      try {
        workerName = workspaceStore.getWorker(workspaceId, dispatch.toAgentId).name
      } catch {
        // worker 可能已被删；用 agentId 兜底，仍要通知 user。
      }
      void mobilePushService
        .notifyStaleDispatch(workspaceId, {
          dispatchId: dispatch.id,
          escalated: notice.escalated,
          minutesAgo: notice.minutesAgo,
          taskSummary: dispatch.text.slice(0, 80),
          workerName,
        })
        .catch((error) => {
          options.logger?.warn(
            `stale dispatch user notify failed workspace_id=${workspaceId} dispatch_id=${dispatch.id}`,
            error
          )
        })
    },
    // M34：未审代码改动 → push 兜底（never-silent）。复用 stalled-dispatch tick，best-effort。
    surfaceUnreviewedCode: (workspaceId) => {
      try {
        const workers = workspaceStore.listWorkers(workspaceId)
        const roleByAgent = new Map(
          workers.map((worker) => [
            worker.id,
            { commandPresetId: worker.commandPresetId, role: worker.role },
          ])
        )
        const nameByAgent = new Map(workers.map((worker) => [worker.id, worker.name]))
        const dispatches = dispatchLedgerStore.listWorkspaceDispatches(workspaceId)
        const textById = new Map(dispatches.map((dispatch) => [dispatch.id, dispatch.text]))
        const summary = summarizeUnreviewedCodeDispatches(
          dispatches,
          (agentId) => roleByAgent.get(agentId),
          Date.now()
        )
        for (const entry of summary.unreviewed) {
          void mobilePushService
            .notifyUnreviewedCode(workspaceId, {
              dispatchId: entry.dispatchId,
              minutesAgo: entry.minutesAgo,
              taskSummary: (textById.get(entry.dispatchId) ?? '').slice(0, 80),
              workerName: nameByAgent.get(entry.toAgentId) ?? entry.toAgentId,
            })
            .catch((error) => {
              options.logger?.warn(
                `unreviewed code push failed workspace_id=${workspaceId} dispatch_id=${entry.dispatchId}`,
                error
              )
            })
        }
      } catch (error) {
        options.logger?.warn(`unreviewed code surface failed workspace_id=${workspaceId}`, error)
      }
    },
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.agentManager ? { writeRunInput: writeAgentRunInput } : {}),
  })
  const teamOps = createTeamOperations({
    agentRuntime,
    createDispatch: dispatchLedgerStore.createDispatch,
    deleteDispatch: dispatchLedgerStore.deleteDispatch,
    deleteMessage: messageLogStore.deleteMessage,
    findOpenDispatch: dispatchLedgerStore.findOpenDispatch,
    findOpenDispatchById: dispatchLedgerStore.findOpenDispatchById,
    insertMessage: messageLogStore.insertMessage,
    listOpenDispatchesForWorkspace: dispatchLedgerStore.listOpenDispatchesForWorkspace,
    markDispatchCancelled: dispatchLedgerStore.markCancelled,
    markDispatchReportedByWorker: dispatchLedgerStore.markReportedByWorker,
    markDispatchSubmitted: dispatchLedgerStore.markSubmitted,
    onMobileUserInput: (workspaceId) =>
      mobileOrchestratorReplyCapture?.startPendingReply(workspaceId),
    insertMobileChatMessage,
    mobilePushService,
    runDbTransaction: (mutation) => db.transaction(mutation)(),
    tasksFileService,
    workspaceStore,
  })
  startExistingWorkspaceWatches()
  sentinelHeartbeat?.start()
  stalledDispatchNudge.start()

  // 启动时收尾历史孤儿派单：runtime 重启后所有 worker 都是 stopped 且无 active run，
  // 此时把卡在 submitted 已过期的孤儿统一标成 cancelled（tasks.md 同步），清掉噪音。
  // 当前正在 working 的 worker 在重启瞬间也是 stopped，但其 dispatch 通常未过 staleness
  // 阈值；真重启会中断在途 PTY，这些任务本就需重派，故收尾是合理的。
  try {
    const reconciled = teamOps.reconcileOrphanedDispatches()
    if (reconciled.length > 0) {
      options.logger?.info(`reconciled ${reconciled.length} orphaned submitted dispatch(es)`)
    }
  } catch (error) {
    options.logger?.warn('orphaned dispatch reconcile on startup failed', error)
  }

  return {
    agentRunStore,
    agentRunTimelineStore,
    agentRuntime,
    approvalLedger,
    db,
    dispatchLedgerStore,
    feishuBindingsStore,
    messageLogStore,
    mobileAuthStore,
    mobileChatStore,
    mobileChatWatchCallbacks,
    mobileOrchestratorReplyCapture,
    mobilePushService,
    cockpitFileWatchCallbacks,
    settings,
    shellRuntime,
    planFileWatchCallbacks,
    sentinelHeartbeat,
    stalledDispatchNudge,
    tasksFileWatcher,
    tasksFileWatchCallbacks,
    tasksFileService,
    teamOps,
    uiAuth,
    workerOutputTracker,
    workspaceStore,
  }
}

export const createRuntimeStoreLifecycle = ({
  agentManager,
  services,
}: CreateRuntimeStoreLifecycleOptions) => {
  const startAgent = async (
    workspaceId: string,
    agentId: string,
    input: { hivePort: string }
  ): Promise<LiveAgentRun> => {
    services.workspaceStore.getAgent(workspaceId, agentId)
    services.workspaceStore.markAgentStarted(workspaceId, agentId)
    try {
      const run = await services.agentRuntime.startAgent(
        services.workspaceStore.getWorkspaceSnapshot(workspaceId).summary,
        agentId,
        input
      )
      if (run.status === 'error') {
        services.workspaceStore.markAgentStopped(workspaceId, agentId)
      } else {
        services.workerOutputTracker?.attach(workspaceId, agentId, run.runId, run.output)
        services.mobileOrchestratorReplyCapture?.attach(workspaceId, agentId, run.runId)
      }
      return run
    } catch (error) {
      services.workspaceStore.markAgentStopped(workspaceId, agentId)
      throw error
    }
  }

  const autostartConfiguredAgents = async (input: { hivePort: string }) => {
    if (!agentManager) return []
    const starts = services.workspaceStore.listWorkspaces().flatMap((workspace) => {
      seedOrchestratorLaunchConfig(services.agentRuntime, services.settings, workspace.id)
      return services.workspaceStore
        .getWorkspaceSnapshot(workspace.id)
        .agents.filter(
          (agent) =>
            !services.agentRuntime.getActiveRunByAgentId(workspace.id, agent.id) &&
            services.agentRuntime.peekAgentLaunchConfig(workspace.id, agent.id)
        )
        .map(async (agent) => {
          try {
            const run = await startAgent(workspace.id, agent.id, input)
            return {
              agent_id: agent.id,
              error: null,
              ok: true,
              run_id: run.runId,
              workspace_id: workspace.id,
            }
          } catch (error) {
            return {
              agent_id: agent.id,
              error: error instanceof Error ? error.message : String(error),
              ok: false,
              run_id: null,
              workspace_id: workspace.id,
            }
          }
        })
    })
    return Promise.all(starts)
  }

  return {
    close: async () => {
      services.sentinelHeartbeat?.close()
      services.stalledDispatchNudge.close()
      services.shellRuntime.close()
      await services.agentRuntime.close()
      await services.tasksFileWatcher.close()
      services.workerOutputTracker?.closeAll()
      services.mobileOrchestratorReplyCapture?.closeAll()
      services.agentRunStore.close?.()
      services.db.close()
    },
    configureAgentLaunch: (workspaceId: string, agentId: string, input: AgentLaunchConfigInput) => {
      services.workspaceStore.getAgent(workspaceId, agentId)
      services.agentRuntime.configureAgentLaunch(workspaceId, agentId, input)
    },
    peekAgentLaunchConfig: (workspaceId: string, agentId: string) =>
      services.agentRuntime.peekAgentLaunchConfig(workspaceId, agentId),
    deleteWorkspaceShell: (workspaceId: string) => {
      services.shellRuntime.deleteWorkspace(workspaceId)
    },
    closeWorkspaceShell: (workspaceId: string, runId: string) =>
      services.shellRuntime.closeRun(workspaceId, runId),
    getLiveRun: (runId: string) =>
      services.shellRuntime.getLiveRun(runId) ?? services.agentRuntime.getLiveRun(runId),
    getPtyOutputBus: (): PtyOutputBus => {
      if (!agentManager) throw new Error('Agent manager is required for PTY output subscriptions')
      return agentManager.getOutputBus()
    },
    listTerminalRuns: (workspaceId: string) => [
      ...services.workspaceStore.getWorkspaceSnapshot(workspaceId).agents.flatMap((agent) => {
        const run = services.agentRuntime.getActiveRunByAgentId(workspaceId, agent.id)
        if (!run) return []
        const launchConfig = services.agentRuntime.peekAgentLaunchConfig(workspaceId, agent.id)
        return [
          {
            agent_id: agent.id,
            agent_name: agent.name,
            run_id: run.runId,
            started_at: run.startedAt,
            status: run.status,
            terminal_input_profile: resolveTerminalInputProfile(launchConfig),
          },
        ]
      }),
      ...services.shellRuntime.listTerminalRuns(workspaceId),
    ],
    startAgent,
    startWorkspaceShell: (workspaceId: string) =>
      services.shellRuntime.start(
        services.workspaceStore.getWorkspaceSnapshot(workspaceId).summary
      ),
    autostartConfiguredAgents,
    registerTasksListener: (listener: (workspaceId: string, content: string) => void) => {
      services.tasksFileWatchCallbacks.add(listener)
      return () => {
        services.tasksFileWatchCallbacks.delete(listener)
      }
    },
    registerPlanListener: (listener: (workspaceId: string, content: string) => void) => {
      services.planFileWatchCallbacks.add(listener)
      return () => {
        services.planFileWatchCallbacks.delete(listener)
      }
    },
    registerCockpitListener: (listener: (workspaceId: string) => void) => {
      services.cockpitFileWatchCallbacks.add(listener)
      return () => {
        services.cockpitFileWatchCallbacks.delete(listener)
      }
    },
    registerMobileChatListener: (
      listener: (workspaceId: string, message: MobileChatMessage) => void
    ) => {
      services.mobileChatWatchCallbacks.add(listener)
      return () => {
        services.mobileChatWatchCallbacks.delete(listener)
      }
    },
    startWorkspaceWatch: async (workspaceId: string) => {
      const workspace = services.workspaceStore.getWorkspaceSnapshot(workspaceId)
      await services.tasksFileWatcher.start(workspaceId, workspace.summary.path)
    },
    writeRunInput: (runId: string, input: Buffer | string) => {
      if (!agentManager) throw new Error('Agent manager is required for PTY stdin writes')
      if (services.shellRuntime.hasRun(runId)) {
        services.shellRuntime.writeInput(runId, input)
        return
      }
      agentManager.writeInput(runId, input)
    },
    pauseTerminalRun: (runId: string) => {
      if (services.shellRuntime.hasRun(runId)) services.shellRuntime.pauseRun(runId)
      else services.agentRuntime.pauseRun(runId)
    },
    resizeTerminalRun: (runId: string, cols: number, rows: number) => {
      if (services.shellRuntime.hasRun(runId)) services.shellRuntime.resizeRun(runId, cols, rows)
      else services.agentRuntime.resizeAgentRun(runId, cols, rows)
    },
    resumeTerminalRun: (runId: string) => {
      if (services.shellRuntime.hasRun(runId)) services.shellRuntime.resumeRun(runId)
      else services.agentRuntime.resumeRun(runId)
    },
    stopTerminalRun: (runId: string) => {
      if (services.shellRuntime.hasRun(runId)) services.shellRuntime.stopRun(runId)
      else services.agentRuntime.stopAgentRun(runId)
    },
  }
}
