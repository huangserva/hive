import { existsSync, statSync } from 'node:fs'

import type { AgentRuntime } from './agent-runtime.js'
import { buildWorkerCockpitSnapshot } from './agent-stdin-dispatcher.js'
import { parseCockpit } from './cockpit-doc.js'
import type { DispatchRecord } from './dispatch-ledger-store.js'
import { ConflictError } from './http-errors.js'
import type { MessageLogHandle, MessageLogRecord } from './message-log-store.js'
import type {
  MobileChatDirection,
  MobileChatMessage,
  MobileChatMessageType,
} from './mobile-chat-store.js'
import { isMobileAppUserInput } from './mobile-orchestrator-reply-capture.js'
import type { MobilePushService } from './mobile-push.js'
import {
  createReportMessage,
  createSendMessage,
  createStatusMessage,
  createUserInputMessage,
} from './runtime-message-builders.js'
import { getTasksFilePath, type TasksFileService } from './tasks-file.js'
import {
  checkTasksNarrativeNudge,
  type TasksNarrativeNudgeResult,
} from './tasks-narrative-nudge.js'
import type { WorkspaceStore } from './workspace-store.js'

export interface TeamOperationsInput {
  agentRuntime: AgentRuntime
  createDispatch: (input: {
    fromAgentId?: string
    text: string
    toAgentId: string
    workspaceId: string
  }) => DispatchRecord
  deleteDispatch: (dispatchId: string) => void
  deleteMessage: (handle: MessageLogHandle) => void
  findOpenDispatch: (
    workspaceId: string,
    toAgentId: string,
    dispatchId?: string
  ) => DispatchRecord | undefined
  findOpenDispatchById: (workspaceId: string, dispatchId: string) => DispatchRecord | undefined
  insertMessage: (record: MessageLogRecord) => MessageLogHandle
  insertMobileChatMessage?: (
    workspaceId: string,
    direction: MobileChatDirection,
    messageType: MobileChatMessageType,
    contentJson: string
  ) => MobileChatMessage
  listOpenDispatchesForWorkspace: (workspaceId: string) => DispatchRecord[]
  markDispatchCancelled: (input: {
    dispatchId: string
    reason: string
    workspaceId: string
  }) => DispatchRecord | undefined
  markDispatchReportedByWorker: (input: {
    artifacts: string[]
    dispatchId?: string
    reportText: string
    toAgentId: string
    workspaceId: string
  }) => DispatchRecord | undefined
  markDispatchSubmitted: (dispatchId: string) => void
  mobilePushService?: Pick<MobilePushService, 'notifyWorkerDone'>
  onMobileUserInput?: (workspaceId: string) => void
  runDbTransaction?: <T>(mutation: () => T) => T
  tasksFileService?: Pick<
    TasksFileService,
    'recordDispatchCancelled' | 'recordDispatchDone' | 'recordDispatchSent'
  >
  workspaceStore: WorkspaceStore
}

export interface DispatchTaskInput {
  fromAgentId?: string
  hivePort?: string
  senderName?: string
}

export interface ReportTaskInput {
  artifacts?: string[]
  dispatchId?: string
  requireActiveRun?: boolean
  status?: string
  text?: string
}

export interface StatusTaskInput {
  artifacts?: string[]
  requireActiveRun?: boolean
  text?: string
}

export interface CancelTaskInput {
  fromAgentId: string
  reason: string
}

export interface ReconcileOrphanedDispatchesInput {
  now?: number
  staleMs?: number
  workspaceId?: string
}

// 孤儿派单收尾：一条 dispatch 卡在 submitted、目标 worker 已 stopped/已删 且无 active run，
// 就再也不会有人 report 了（worker 在别的 dispatch 下 report、或 worker 已停）。把这种
// 「明确孤儿」标成 cancelled，避免无限堆在 In progress 段当噪音。语义与 sentinel 巡检
// (sentinel-heartbeat.ts STALE_SUBMITTED_DISPATCH_MS) 对齐：默认 15 分钟 staleness 阈值，
// 防止刚派出去、worker 还没起来/正在原生 resume 的在途任务被误杀。
export const ORPHAN_DISPATCH_CANCEL_REASON = 'orphan-submitted: worker stopped without reporting'
const ORPHAN_SUBMITTED_STALE_MS = 15 * 60 * 1000

export interface ReportTaskResult {
  dispatch: DispatchRecord | null
  forwardError: string | null
  forwarded: boolean
}

const reportForwardErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const noopTasksFileService: Pick<
  TasksFileService,
  'recordDispatchCancelled' | 'recordDispatchDone' | 'recordDispatchSent'
> = {
  recordDispatchCancelled: () => {},
  recordDispatchDone: () => {},
  recordDispatchSent: () => {},
}

interface TasksNarrativeState {
  count: number
  lastRuntimeMtime: number | null
  narrativeMtime: number | null
}

const readTasksMtime = (workspacePath: string) => {
  const tasksFilePath = getTasksFilePath(workspacePath)
  if (!existsSync(tasksFilePath)) return null
  return statSync(tasksFilePath).mtimeMs
}

const buildNudgeDedupeKey = (result: TasksNarrativeNudgeResult) => {
  if (result.rule === null || result.reason === null) return null
  if (result.rule === 2) return 'rule:2:dispatch-backlog'
  const milestone =
    result.reason.match(/\bM\d+(?:\.\d+)?[a-z]?\b/iu)?.[0]?.toLowerCase() ?? 'unknown'
  return `rule:${result.rule}:${milestone}`
}

export const createTeamOperations = ({
  agentRuntime,
  createDispatch,
  deleteDispatch,
  deleteMessage,
  findOpenDispatch,
  findOpenDispatchById,
  insertMessage,
  insertMobileChatMessage,
  listOpenDispatchesForWorkspace,
  markDispatchCancelled,
  markDispatchReportedByWorker,
  markDispatchSubmitted,
  mobilePushService,
  onMobileUserInput,
  runDbTransaction = (mutation) => mutation(),
  tasksFileService = noopTasksFileService,
  workspaceStore,
}: TeamOperationsInput) => {
  const triggeredTasksNarrativeNudges = new Set<string>()
  const tasksNarrativeStates = new Map<string, TasksNarrativeState>()

  const getWorkspacePath = (workspaceId: string) => {
    if (tasksFileService === noopTasksFileService) {
      return null
    }
    return workspaceStore.getWorkspaceSnapshot(workspaceId).summary.path
  }

  const incrementRecentDispatchCount = (workspaceId: string, workspacePath: string) => {
    const currentMtime = readTasksMtime(workspacePath)
    const existing = tasksNarrativeStates.get(workspaceId)
    const externallyChanged =
      existing &&
      currentMtime !== null &&
      existing.lastRuntimeMtime !== null &&
      currentMtime !== existing.lastRuntimeMtime

    const state =
      existing && !externallyChanged
        ? existing
        : {
            count: 0,
            lastRuntimeMtime: null,
            narrativeMtime: currentMtime,
          }
    state.count += 1
    tasksNarrativeStates.set(workspaceId, state)
    return state
  }

  const updateRuntimeTasksMtime = (workspaceId: string, workspacePath: string) => {
    const state = tasksNarrativeStates.get(workspaceId)
    if (!state) return
    state.lastRuntimeMtime = readTasksMtime(workspacePath)
  }

  const maybeNudgeTasksNarrative = (
    workspaceId: string,
    workspacePath: string,
    taskText: string,
    recentDispatchState: TasksNarrativeState | null
  ) => {
    if (!recentDispatchState) return
    const result = checkTasksNarrativeNudge(
      taskText,
      workspacePath,
      recentDispatchState.count,
      recentDispatchState.narrativeMtime
    )
    if (!result.shouldNudge || result.reason === null) return
    const dedupeKey = buildNudgeDedupeKey(result)
    if (dedupeKey && triggeredTasksNarrativeNudges.has(dedupeKey)) return
    if (dedupeKey) triggeredTasksNarrativeNudges.add(dedupeKey)
    try {
      agentRuntime.writeTasksNarrativeNudgePrompt(workspaceId, result.reason)
    } catch (error) {
      console.error('[hive] swallowed:tasksNarrativeNudge.forward', error)
    }
  }

  const ensureWorkerRun = async (workspaceId: string, workerId: string, hivePort: string) => {
    if (agentRuntime.getActiveRunByAgentId(workspaceId, workerId)) {
      return
    }

    const config = agentRuntime.peekAgentLaunchConfig(workspaceId, workerId)
    if (!config) {
      throw new ConflictError('No worker launch config available')
    }

    workspaceStore.markAgentStarted(workspaceId, workerId)
    try {
      const run = await agentRuntime.startAgent(
        workspaceStore.getWorkspaceSnapshot(workspaceId).summary,
        workerId,
        { hivePort }
      )
      if (run.status === 'error') {
        workspaceStore.markAgentStopped(workspaceId, workerId)
        throw new ConflictError(`${config.command} failed to start`)
      }
    } catch (error) {
      workspaceStore.markAgentStopped(workspaceId, workerId)
      throw error
    }
  }

  const dispatchTask = async (
    workspaceId: string,
    workerId: string,
    text: string,
    input: DispatchTaskInput = {}
  ) => {
    const message = createSendMessage(workspaceId, workerId, text, input.fromAgentId)
    const messageHandle = insertMessage(message)
    let dispatch: DispatchRecord | undefined

    try {
      const dispatchInput: {
        fromAgentId?: string
        text: string
        toAgentId: string
        workspaceId: string
      } = {
        text,
        toAgentId: workerId,
        workspaceId,
      }
      if (input.fromAgentId) dispatchInput.fromAgentId = input.fromAgentId
      dispatch = createDispatch(dispatchInput)

      const worker = workspaceStore.getWorker(workspaceId, workerId)
      const hasActiveRun = !!agentRuntime.getActiveRunByAgentId?.(workspaceId, workerId)
      const hasLaunchConfig = !!agentRuntime.peekAgentLaunchConfig?.(workspaceId, workerId)
      if (input.fromAgentId || hasActiveRun || hasLaunchConfig) {
        const senderName = input.fromAgentId
          ? workspaceStore.getAgent(workspaceId, input.fromAgentId).name
          : (input.senderName ?? 'mobile')
        await ensureWorkerRun(workspaceId, workerId, input.hivePort ?? '')
        const promptWorker = workspaceStore.getWorker(workspaceId, workerId)
        const workspacePath = getWorkspacePath(workspaceId)
        const cockpitSnapshot = workspacePath
          ? buildWorkerCockpitSnapshot(parseCockpit(workspacePath))
          : undefined
        markDispatchSubmitted(dispatch.id)
        agentRuntime.writeSendPrompt(
          workspaceId,
          workerId,
          dispatch.id,
          senderName,
          promptWorker.description,
          text,
          cockpitSnapshot
        )
      }

      workspaceStore.markTaskDispatched(workspaceId, workerId)
      const workspacePath = getWorkspacePath(workspaceId)
      if (workspacePath) {
        const recentDispatchState =
          worker.role === 'sentinel'
            ? null
            : incrementRecentDispatchCount(workspaceId, workspacePath)
        tasksFileService.recordDispatchSent(workspacePath, {
          dispatchId: dispatch.id,
          taskFirstLine: text,
          workerName: worker.name,
        })
        updateRuntimeTasksMtime(workspaceId, workspacePath)
        maybeNudgeTasksNarrative(workspaceId, workspacePath, text, recentDispatchState)
      }
      insertMobileChatMessage?.(
        workspaceId,
        'outbound',
        'system_event',
        JSON.stringify({
          event: 'dispatch',
          task_summary: text.trim().split(/\r?\n/u)[0]?.slice(0, 160) ?? '',
          worker: worker.name,
        })
      )
      return dispatch
    } catch (error) {
      if (dispatch) deleteDispatch(dispatch.id)
      deleteMessage(messageHandle)
      throw error
    }
  }

  // 判定一条 open dispatch 是否是「可安全收尾」的孤儿。只收明确孤儿：
  // submitted + 已过 staleness 阈值 + 无 active run + （worker 已删 或 status==='stopped'）。
  // worker 还在 working/idle（在途，可能正在做或马上 report）一律不动。
  const isReconcilableOrphan = (
    workspaceId: string,
    dispatch: DispatchRecord,
    now: number,
    staleMs: number
  ) => {
    if (dispatch.status !== 'submitted' || dispatch.submittedAt === null) return false
    if (now - dispatch.submittedAt < staleMs) return false
    // 在途保护：worker 还有 active run = 合法在途，绝不收尾。
    if (agentRuntime.getActiveRunByAgentId?.(workspaceId, dispatch.toAgentId)) return false
    // worker 已被删除 = 明确孤儿；否则必须是 stopped 态才算孤儿。
    if (!workspaceStore.hasAgent(workspaceId, dispatch.toAgentId)) return true
    return workspaceStore.getWorker(workspaceId, dispatch.toAgentId).status === 'stopped'
  }

  return {
    cancelTask(workspaceId: string, dispatchId: string, input: CancelTaskInput) {
      workspaceStore.getAgent(workspaceId, input.fromAgentId)
      const openDispatch = findOpenDispatchById(workspaceId, dispatchId)
      if (!openDispatch) {
        throw new ConflictError(`No open dispatch: ${dispatchId}`)
      }
      workspaceStore.getWorker(workspaceId, openDispatch.toAgentId)
      const dispatch = markDispatchCancelled({
        dispatchId,
        reason: input.reason,
        workspaceId,
      })
      if (!dispatch) {
        throw new ConflictError(`No open dispatch: ${dispatchId}`)
      }
      workspaceStore.markTaskCancelled(workspaceId, dispatch.toAgentId)
      const workspacePath = getWorkspacePath(workspaceId)
      if (workspacePath) {
        tasksFileService.recordDispatchCancelled(workspacePath, {
          dispatchId: dispatch.id,
          reason: input.reason,
        })
      }
      let forwardError: string | null = null
      let forwarded = false
      try {
        agentRuntime.writeCancelPrompt(workspaceId, dispatch.toAgentId, dispatch.id, input.reason)
        forwarded = true
      } catch (error) {
        forwardError = reportForwardErrorMessage(error)
        console.error('[hive] swallowed:teamCancel.forward', error)
      }
      return { dispatch, forwardError, forwarded }
    },
    reconcileOrphanedDispatches(input: ReconcileOrphanedDispatchesInput = {}) {
      const now = input.now ?? Date.now()
      const staleMs = input.staleMs ?? ORPHAN_SUBMITTED_STALE_MS
      const workspaceIds = input.workspaceId
        ? [input.workspaceId]
        : workspaceStore.listWorkspaces().map((workspace) => workspace.id)
      const reconciled: DispatchRecord[] = []
      for (const workspaceId of workspaceIds) {
        for (const dispatch of listOpenDispatchesForWorkspace(workspaceId)) {
          if (!isReconcilableOrphan(workspaceId, dispatch, now, staleMs)) continue
          const cancelled = markDispatchCancelled({
            dispatchId: dispatch.id,
            reason: ORPHAN_DISPATCH_CANCEL_REASON,
            workspaceId,
          })
          if (!cancelled) continue
          // worker 还在（只是 stopped）才更新它的 pending 计数；已删 worker 跳过。
          if (workspaceStore.hasAgent(workspaceId, cancelled.toAgentId)) {
            workspaceStore.markTaskCancelled(workspaceId, cancelled.toAgentId)
          }
          const workspacePath = getWorkspacePath(workspaceId)
          if (workspacePath) {
            tasksFileService.recordDispatchCancelled(workspacePath, {
              dispatchId: cancelled.id,
              reason: ORPHAN_DISPATCH_CANCEL_REASON,
            })
          }
          reconciled.push(cancelled)
        }
      }
      return reconciled
    },
    dispatchTask,
    dispatchTaskByWorkerName(
      workspaceId: string,
      workerName: string,
      text: string,
      input: DispatchTaskInput = {}
    ) {
      const worker = workspaceStore.getWorkerByName(workspaceId, workerName)
      return dispatchTask(workspaceId, worker.id, text, input)
    },
    recordUserInput(
      workspaceId: string,
      orchestratorId: string,
      text: string,
      input: { forwardToOrchestrator?: boolean } = {}
    ) {
      workspaceStore.getAgent(workspaceId, orchestratorId)
      if (isMobileAppUserInput(text)) onMobileUserInput?.(workspaceId)
      if (input.forwardToOrchestrator !== false) {
        agentRuntime.writeUserInputPrompt(workspaceId, text)
      }
      insertMessage(createUserInputMessage(workspaceId, orchestratorId, text))
    },
    statusTask(workspaceId: string, workerId: string, input: StatusTaskInput = {}) {
      const text = input.text ?? ''
      const artifacts = input.artifacts ?? []
      const worker = workspaceStore.getWorker(workspaceId, workerId)
      const messageHandle = insertMessage(
        createStatusMessage(workspaceId, workerId, text, artifacts)
      )
      try {
        let forwardError: string | null = null
        let forwarded = false
        if (input.requireActiveRun === true) {
          try {
            agentRuntime.writeStatusPrompt(workspaceId, worker.name, workerId, text, artifacts, {
              requireActiveRun: input.requireActiveRun,
            })
            forwarded = true
          } catch (error) {
            forwardError = reportForwardErrorMessage(error)
            console.error('[hive] swallowed:teamStatus.forward', error)
          }
        }
        return { dispatch: null, forwardError, forwarded }
      } catch (error) {
        deleteMessage(messageHandle)
        throw error
      }
    },
    reportTask(workspaceId: string, workerId: string, input: ReportTaskInput = {}) {
      const text = input.text ?? ''
      const status = input.status
      const artifacts = input.artifacts ?? []
      const worker = workspaceStore.getWorker(workspaceId, workerId)
      const openDispatch = findOpenDispatch(workspaceId, workerId, input.dispatchId)
      if (!openDispatch && input.dispatchId) {
        throw new ConflictError(`No open dispatch for worker: ${worker.name}`)
      }
      if (!openDispatch) {
        throw new ConflictError(`No open dispatch for worker: ${worker.name}`)
      }
      let messageHandle: MessageLogHandle | null = null
      let dbCommitted = false
      try {
        const dispatch = runDbTransaction(() => {
          messageHandle = insertMessage(
            createReportMessage(workspaceId, workerId, text, status, artifacts)
          )
          const reportedDispatch = markDispatchReportedByWorker({
            artifacts,
            ...(input.dispatchId ? { dispatchId: input.dispatchId } : {}),
            reportText: text,
            toAgentId: workerId,
            workspaceId,
          })
          if (!reportedDispatch) {
            throw new ConflictError(`No open dispatch for worker: ${worker.name}`)
          }
          insertMobileChatMessage?.(
            workspaceId,
            'outbound',
            'worker_report',
            JSON.stringify({
              dispatch_id: reportedDispatch.id,
              summary: text.trim().split(/\r?\n/u)[0]?.slice(0, 240) ?? '',
              worker_name: worker.name,
            })
          )
          return reportedDispatch
        })
        dbCommitted = true
        workspaceStore.markTaskReported(workspaceId, workerId)
        const workspacePath = getWorkspacePath(workspaceId)
        if (workspacePath) {
          tasksFileService.recordDispatchDone(workspacePath, {
            dispatchId: dispatch.id,
          })
        }
        void mobilePushService?.notifyWorkerDone(workspaceId, worker.name, text, dispatch.id)
        let forwardError: string | null = null
        let forwarded = false
        const orchActive =
          input.requireActiveRun !== true ||
          !!agentRuntime.getActiveRunByAgentId(workspaceId, `${workspaceId}:orchestrator`)
        if (orchActive) {
          try {
            agentRuntime.writeReportPrompt(workspaceId, worker.name, workerId, text, artifacts, {
              ...(input.requireActiveRun === undefined
                ? {}
                : { requireActiveRun: input.requireActiveRun }),
            })
            forwarded = true
          } catch (error) {
            forwardError = reportForwardErrorMessage(error)
            console.error('[hive] swallowed:teamReport.forward', error)
          }
        } else {
          forwardError = 'Orchestrator PTY inactive, report recorded but not forwarded'
        }
        return { dispatch, forwardError, forwarded }
      } catch (error) {
        if (!dbCommitted && messageHandle) deleteMessage(messageHandle)
        throw error
      }
    },
  }
}
