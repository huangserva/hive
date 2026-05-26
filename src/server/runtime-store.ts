import type { AgentSummary, TeamListItem, WorkspaceSummary } from '../shared/types.js'
import type { AgentManager } from './agent-manager.js'
import type { AgentLaunchConfigInput, PersistedAgentRun } from './agent-run-store.js'
import type { LiveAgentRun } from './agent-runtime-types.js'
import type { DispatchRecord, ListDispatchesOptions } from './dispatch-ledger-store.js'
import type { ApprovalLedger } from './feishu-approval-ledger.js'
import type { FeishuBinding } from './feishu-bindings-store.js'
import { NotFoundError } from './http-errors.js'
import type { HiveLogger } from './logger.js'
import type { RecoveryMessage } from './message-log-store.js'
import type { MobileCapability, MobileDeviceRecord } from './mobile-auth.js'
import type { PtyOutputBus } from './pty-output-bus.js'
import { createRuntimeStoreLifecycle, createRuntimeStoreServices } from './runtime-store-helpers.js'
import type { SettingsStore } from './settings-store.js'
import type {
  CancelTaskInput,
  DispatchTaskInput,
  ReportTaskInput,
  ReportTaskResult,
  StatusTaskInput,
} from './team-operations.js'
import type { TerminalRunSummary } from './terminal-input-profile.js'
import type {
  WorkerConfig,
  WorkerConfigPatch,
  WorkerInput,
  WorkspaceRecord,
} from './workspace-store.js'

interface RuntimeStore {
  close: () => Promise<void>
  approvalLedger: ApprovalLedger
  createWorkspace: (path: string, name: string) => WorkspaceSummary
  deleteWorkspace: (workspaceId: string) => Promise<void>
  listWorkspaces: () => WorkspaceSummary[]
  addWorker: (workspaceId: string, input: WorkerInput) => AgentSummary
  deleteWorker: (workspaceId: string, workerId: string) => void
  renameWorker: (workspaceId: string, workerId: string, name: string) => AgentSummary
  updateWorkerDescription: (
    workspaceId: string,
    workerId: string,
    description: string
  ) => AgentSummary
  updateWorkerConfig: (
    workspaceId: string,
    workerId: string,
    configPatch: WorkerConfigPatch
  ) => WorkerConfig
  recordUserInput: (workspaceId: string, orchestratorId: string, text: string) => void
  notifyQuestionAnswered: (workspaceId: string, questionId: string, answer: string) => void
  dispatchTask: (
    workspaceId: string,
    workerId: string,
    text: string,
    input?: DispatchTaskInput
  ) => Promise<DispatchRecord>
  dispatchTaskByWorkerName: (
    workspaceId: string,
    workerName: string,
    text: string,
    input?: DispatchTaskInput
  ) => Promise<DispatchRecord>
  reportTask: (workspaceId: string, workerId: string, input?: ReportTaskInput) => ReportTaskResult
  statusTask: (workspaceId: string, workerId: string, input?: StatusTaskInput) => ReportTaskResult
  cancelTask: (workspaceId: string, dispatchId: string, input: CancelTaskInput) => ReportTaskResult
  listDispatches: (workspaceId: string, options?: ListDispatchesOptions) => DispatchRecord[]
  listWorkers: (workspaceId: string) => TeamListItem[]
  getLastPtyLineForAgent: (workspaceId: string, agentId: string) => string | null
  getPtySnapshotForAgent: (workspaceId: string, agentId: string) => Promise<string | null>
  getWorkspaceSnapshot: (workspaceId: string) => WorkspaceRecord
  getWorker: (workspaceId: string, workerId: string) => AgentSummary
  getWorkerConfig: (workspaceId: string, workerId: string) => WorkerConfig
  getAgent: (workspaceId: string, agentId: string) => AgentSummary
  getPtyOutputBus: () => PtyOutputBus
  listTerminalRuns: (workspaceId: string) => TerminalRunSummary[]
  closeWorkspaceShell: (workspaceId: string, runId: string) => boolean
  startWorkspaceShell: (workspaceId: string) => Promise<LiveAgentRun>
  configureAgentLaunch: (
    workspaceId: string,
    agentId: string,
    input: AgentLaunchConfigInput
  ) => void
  peekAgentLaunchConfig: (
    workspaceId: string,
    agentId: string
  ) => AgentLaunchConfigInput | undefined
  startAgent: (
    workspaceId: string,
    agentId: string,
    input: StartAgentOptions
  ) => Promise<LiveAgentRun>
  autostartConfiguredAgents: (input: StartAgentOptions) => Promise<
    Array<{
      agent_id: string
      error: string | null
      ok: boolean
      run_id: string | null
      workspace_id: string
    }>
  >
  startWorkspaceWatch: (workspaceId: string) => Promise<void>
  getLiveRun: (runId: string) => LiveAgentRun
  getActiveRunByAgentId: (workspaceId: string, agentId: string) => LiveAgentRun | undefined
  registerCockpitListener: (listener: (workspaceId: string) => void) => () => void
  registerPlanListener: (listener: (workspaceId: string, content: string) => void) => () => void
  registerTasksListener: (listener: (workspaceId: string, content: string) => void) => () => void
  listAgentRuns: (agentId: string) => PersistedAgentRun[]
  listMessagesForRecovery: (workspaceId: string, sinceMs: number) => RecoveryMessage[]
  peekAgentToken: (agentId: string) => string | undefined
  pauseTerminalRun: (runId: string) => void
  resizeAgentRun: (runId: string, cols: number, rows: number) => void
  resumeTerminalRun: (runId: string) => void
  settings: SettingsStore
  writeRunInput: (runId: string, input: Buffer | string) => void
  getUiToken: () => string
  ensureMobileAccessToken: () => MobileDeviceRecord
  authenticateMobileDevice: (token: string | undefined) => MobileDeviceRecord
  generateMobilePairingCode: (
    deviceName: string,
    capabilities: MobileCapability[],
    expiresInMs?: number
  ) => { capabilities: MobileCapability[]; code: string; device_name: string; expires_at: number }
  listMobileDevices: () => MobileDeviceRecord[]
  redeemMobilePairingCode: (code: string) => { device: MobileDeviceRecord; token: string }
  requireMobileCapability: (device: MobileDeviceRecord, capability: MobileCapability) => void
  revokeMobileDevice: (deviceId: string) => MobileDeviceRecord
  clearMobilePushToken: (pushToken: string) => void
  updateMobileDevice: (
    deviceId: string,
    patch: { capabilities?: MobileCapability[]; name?: string }
  ) => MobileDeviceRecord
  updateMobilePushToken: (deviceId: string, pushToken: string) => MobileDeviceRecord
  stopAgentRun: (runId: string) => void
  validateAgentToken: (agentId: string, token: string | undefined) => boolean
  validateUiToken: (token: string | undefined) => boolean
  validateMobileToken: (token: string | undefined) => boolean
  bindFeishuChat: (input: {
    workspaceId: string
    chatId: string
    chatName?: string | null
  }) => FeishuBinding
  unbindFeishuChat: (chatId: string) => boolean
  findFeishuBindingByChatId: (chatId: string) => FeishuBinding | null
  listFeishuBindings: (workspaceId?: string) => FeishuBinding[]
}

interface RuntimeStoreOptions {
  dataDir?: string
  agentManager?: AgentManager
  logger?: HiveLogger
}

interface StartAgentOptions {
  hivePort: string
}

export type { RuntimeStore }

export const createRuntimeStore = (options: RuntimeStoreOptions = {}): RuntimeStore => {
  const services = createRuntimeStoreServices(options)
  const lifecycle = createRuntimeStoreLifecycle(
    options.agentManager ? { agentManager: options.agentManager, services } : { services }
  )
  const runDataMutation = (mutation: () => void) => {
    if (!services.db) {
      mutation()
      return
    }
    services.db.transaction(mutation)()
  }
  return {
    approvalLedger: services.approvalLedger,
    close: lifecycle.close,
    createWorkspace: (path, name) => {
      const workspace = services.workspaceStore.createWorkspace(path, name)
      void lifecycle.startWorkspaceWatch(workspace.id)
      return workspace
    },
    listWorkspaces: () => services.workspaceStore.listWorkspaces(),
    deleteWorkspace: async (workspaceId) => {
      const workspace = services.workspaceStore.getWorkspaceSnapshot(workspaceId)
      lifecycle.deleteWorkspaceShell(workspaceId)
      for (const agent of workspace.agents) {
        const activeRun = services.agentRuntime.getActiveRunByAgentId(workspaceId, agent.id)
        if (activeRun) services.agentRuntime.stopAgentRun(activeRun.runId)
        services.agentRuntime.deleteAgentLaunchConfig(workspaceId, agent.id)
      }
      await services.tasksFileWatcher.stop(workspaceId)
      runDataMutation(() => {
        services.dispatchLedgerStore.deleteWorkspaceDispatches(workspaceId)
        services.feishuBindingsStore.unbindByWorkspace(workspaceId)
        services.workspaceStore.deleteWorkspace(workspaceId)
      })
      if (services.settings.getAppState('active_workspace_id')?.value === workspaceId) {
        services.settings.setAppState('active_workspace_id', null)
      }
    },
    addWorker: (workspaceId, input) => services.workspaceStore.addWorker(workspaceId, input),
    renameWorker: (workspaceId, workerId, name) =>
      services.workspaceStore.renameWorker(workspaceId, workerId, name),
    updateWorkerDescription: (workspaceId, workerId, description) =>
      services.workspaceStore.updateWorkerDescription(workspaceId, workerId, description),
    updateWorkerConfig: (workspaceId, workerId, configPatch) =>
      services.workspaceStore.updateWorkerConfig(workspaceId, workerId, configPatch),
    deleteWorker: (workspaceId, workerId) => {
      const activeRun = services.agentRuntime.getActiveRunByAgentId(workspaceId, workerId)
      if (activeRun) services.agentRuntime.stopAgentRun(activeRun.runId)
      services.agentRuntime.deleteAgentLaunchConfig(workspaceId, workerId)
      runDataMutation(() => {
        services.dispatchLedgerStore.deleteWorkerDispatches(workspaceId, workerId)
        services.workspaceStore.deleteWorker(workspaceId, workerId)
      })
    },
    recordUserInput: services.teamOps.recordUserInput,
    notifyQuestionAnswered: (workspaceId, questionId, answer) => {
      services.agentRuntime.writeQuestionAnsweredPrompt(workspaceId, questionId, answer)
    },
    cancelTask: services.teamOps.cancelTask,
    dispatchTask: services.teamOps.dispatchTask,
    dispatchTaskByWorkerName: services.teamOps.dispatchTaskByWorkerName,
    reportTask: services.teamOps.reportTask,
    statusTask: services.teamOps.statusTask,
    listDispatches: services.dispatchLedgerStore.listWorkspaceDispatches,
    listWorkers: (workspaceId) => services.workspaceStore.listWorkers(workspaceId),
    getLastPtyLineForAgent: (workspaceId, agentId) =>
      services.workerOutputTracker?.getLastPtyLine(workspaceId, agentId) ?? null,
    getPtySnapshotForAgent: (workspaceId, agentId) =>
      services.workerOutputTracker?.getSnapshot(workspaceId, agentId) ?? Promise.resolve(null),
    getWorkspaceSnapshot: (workspaceId) =>
      services.workspaceStore.getWorkspaceSnapshot(workspaceId),
    getWorker: (workspaceId, workerId) => services.workspaceStore.getWorker(workspaceId, workerId),
    getWorkerConfig: (workspaceId, workerId) =>
      services.workspaceStore.getWorkerConfig(workspaceId, workerId),
    getAgent: (workspaceId, agentId) => services.workspaceStore.getAgent(workspaceId, agentId),
    getPtyOutputBus: lifecycle.getPtyOutputBus,
    listTerminalRuns: lifecycle.listTerminalRuns,
    closeWorkspaceShell: lifecycle.closeWorkspaceShell,
    configureAgentLaunch: lifecycle.configureAgentLaunch,
    peekAgentLaunchConfig: lifecycle.peekAgentLaunchConfig,
    startAgent: lifecycle.startAgent,
    autostartConfiguredAgents: lifecycle.autostartConfiguredAgents,
    startWorkspaceWatch: lifecycle.startWorkspaceWatch,
    startWorkspaceShell: lifecycle.startWorkspaceShell,
    getLiveRun: lifecycle.getLiveRun,
    getActiveRunByAgentId: (workspaceId, agentId) =>
      services.agentRuntime.getActiveRunByAgentId(workspaceId, agentId),
    registerCockpitListener: lifecycle.registerCockpitListener,
    registerPlanListener: lifecycle.registerPlanListener,
    registerTasksListener: lifecycle.registerTasksListener,
    listAgentRuns: (agentId) => services.agentRuntime.listAgentRuns(agentId),
    listMessagesForRecovery: (workspaceId, sinceMs) =>
      services.messageLogStore.listMessagesForRecovery(workspaceId, sinceMs),
    peekAgentToken: (agentId) => services.agentRuntime.peekAgentToken(agentId),
    pauseTerminalRun: lifecycle.pauseTerminalRun,
    resizeAgentRun: lifecycle.resizeTerminalRun,
    resumeTerminalRun: lifecycle.resumeTerminalRun,
    settings: services.settings,
    writeRunInput: lifecycle.writeRunInput,
    getUiToken: () => services.uiAuth.getToken(),
    ensureMobileAccessToken: () => services.mobileAuthStore.ensureDefaultDevice(),
    authenticateMobileDevice: (token) => services.mobileAuthStore.authenticateDevice(token),
    generateMobilePairingCode: (deviceName, capabilities, expiresInMs) =>
      services.mobileAuthStore.generatePairingCode(deviceName, capabilities, expiresInMs),
    listMobileDevices: () => services.mobileAuthStore.listDevices(),
    redeemMobilePairingCode: (code) => services.mobileAuthStore.redeemPairingCode(code),
    requireMobileCapability: (device, capability) =>
      services.mobileAuthStore.requireCapability(device, capability),
    revokeMobileDevice: (deviceId) => services.mobileAuthStore.revokeDevice(deviceId),
    clearMobilePushToken: (pushToken) => services.mobileAuthStore.clearPushToken(pushToken),
    updateMobileDevice: (deviceId, patch) => services.mobileAuthStore.updateDevice(deviceId, patch),
    updateMobilePushToken: (deviceId, pushToken) =>
      services.mobileAuthStore.updatePushToken(deviceId, pushToken),
    stopAgentRun: lifecycle.stopTerminalRun,
    validateAgentToken: (agentId, token) =>
      services.agentRuntime.validateAgentToken(agentId, token),
    validateUiToken: (token) => services.uiAuth.validate(token),
    validateMobileToken: (token) => services.mobileAuthStore.validateToken(token),
    bindFeishuChat: (input) => {
      try {
        services.workspaceStore.getWorkspaceSnapshot(input.workspaceId)
      } catch {
        throw new NotFoundError(`Workspace not found: ${input.workspaceId}`)
      }
      return services.feishuBindingsStore.bind(input)
    },
    unbindFeishuChat: (chatId) => services.feishuBindingsStore.unbind(chatId),
    findFeishuBindingByChatId: (chatId) => services.feishuBindingsStore.findByChatId(chatId),
    listFeishuBindings: (workspaceId) => {
      if (workspaceId) {
        try {
          services.workspaceStore.getWorkspaceSnapshot(workspaceId)
        } catch {
          throw new NotFoundError(`Workspace not found: ${workspaceId}`)
        }
        return services.feishuBindingsStore.listByWorkspace(workspaceId)
      }
      return services.feishuBindingsStore.listAll()
    },
  }
}
