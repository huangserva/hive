import { existsSync, statSync } from 'node:fs'

import type { AgentRuntime } from './agent-runtime.js'
import { buildWorkerCockpitSnapshot } from './agent-stdin-dispatcher.js'
import { parseCockpit } from './cockpit-doc.js'
import {
  type AcceptVerdict,
  type DispatchRecord,
  isActiveDispatchStatus,
  isCompletedDispatchStatus,
  isOpenDispatchStatus,
  type ReviewStatus,
} from './dispatch-ledger-store.js'
import { BadRequestError, ConflictError } from './http-errors.js'
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
import { isReportOnlyDispatch } from './unreviewed-code-status.js'
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
  markDispatchOrphaned?: (input: {
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
  mobilePushService?: Pick<MobilePushService, 'notifyWorkerDone'> &
    Partial<Pick<MobilePushService, 'notifyOrchestratorForwardFailure'>>
  onMobileUserInput?: (workspaceId: string) => void
  runDbTransaction?: <T>(mutation: () => T) => T
  tasksFileService?: Pick<
    TasksFileService,
    'recordDispatchCancelled' | 'recordDispatchDone' | 'recordDispatchSent'
  > &
    Partial<Pick<TasksFileService, 'recordDispatchRolledBack'>>
  workspaceStore: WorkspaceStore
  // M43 accept-gate 旁挂字段读写（dispatch-ledger-store 暴露）。Phase 1 全部 optional：
  // 缺任意一个 hook 都按"未启用 accept gate"行为走旧路径，绝不破坏 flag=0 兼容性。
  findDispatchById?: (workspaceId: string, dispatchId: string) => DispatchRecord | undefined
  setReviewStatus?: (dispatchId: string, status: ReviewStatus | null) => void
  applyAcceptVerdict?: (dispatchId: string, verdict: AcceptVerdict) => void
  linkReviewsDispatchId?: (reviewerDispatchId: string, coderDispatchId: string) => void
  clearReviewStatus?: (dispatchId: string) => void
  // M43 scope 解析（commandPresetId 在 worker launch config 上，需要解析）；缺则按"非 claude coder" 处理 → 不入 scope。
  resolveCommandPresetId?: (workspaceId: string, workerId: string) => string | undefined
  // M43 acceptTask 需查全 dispatches（含 reported reviewer dispatch）以校验 reason 引的 hex prefix 是 reviewer-role。
  listAllWorkspaceDispatches?: (workspaceId: string) => DispatchRecord[]
  reconcileAgentStatus?: (workspaceId: string, agentId: string) => void
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
  requireDispatchId?: boolean
  status?: string
  text?: string
  // M43 accept-gate（仅 reviewer 主路径用）：reviewer report 时显式指向被审 coder dispatch.id
  // + 携带 accept verdict。flag=0 时即便传了也走旧路径（reportTask 自己 gate）。
  reviewsDispatchId?: string
  verdict?: ReviewStatus
  verdictReason?: string
}

export interface AcceptTaskInput {
  /** PM 旁路 accept：被审 coder dispatch.id（必须）。 */
  dispatchId: string
  /** 谁 accept（orchestrator agent_id；team-authz 已校验角色）。 */
  fromAgentId: string
  /** verdict 原因，强制要求；按设计要求引用 reviewer dispatch_id（PM 自审反铁律）。 */
  reason: string
  /** 默认 accepted；允许 PM 选 waived（不允许 rejected——rejected 必须走 reviewer report）。 */
  verdict?: 'accepted' | 'waived'
}

export interface AcceptTaskResult {
  dispatch: DispatchRecord
}

const isAcceptGateEnabled = (): boolean => process.env.HIVE_ACCEPT_GATE === '1'

const VERDICT_REASON_REVIEWER_REFERENCE_PATTERN = /\b[0-9a-f]{8}\b/iu

interface WorkerScopeInfo {
  role?: string
  commandPresetId?: string
}

// M43 scope 收窄：Phase 1 仅覆盖 claude coder + 真改 src 的 dispatch（复用 M34 反向排除器）。
// 不在 scope 时 review_status 保持 NULL → 走旧 reported→[x] 路径，零波及。
const isDispatchInAcceptGateScope = (
  dispatch: DispatchRecord,
  worker: WorkerScopeInfo
): boolean => {
  if (worker.role !== 'coder') return false
  if (worker.commandPresetId !== 'claude') return false
  if (isReportOnlyDispatch(dispatch)) return false
  return true
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

export interface RecoverTaskInput {
  fromAgentId: string
}

export interface AbandonTaskInput {
  confirmWorkerStopped: boolean
  fromAgentId: string
}

export interface ReconcileOrphanedDispatchesInput {
  now?: number
  staleMs?: number
  workspaceId?: string
}

export interface ReconcileQueuedDispatchesInput {
  hivePort?: string
  workspaceId?: string
}

export interface ReconcileQueuedDispatchesResult {
  action: 'orphaned' | 'submitted'
  dispatch: DispatchRecord
}

// 孤儿派单收尾：一条 dispatch 卡在 submitted、目标 worker 已 stopped/已删 且无 active run，
// 就再也不会有人 report 了（worker 在别的 dispatch 下 report、或 worker 已停）。把这种
// 「明确孤儿」标成 cancelled，避免无限堆在 In progress 段当噪音。语义与 sentinel 巡检
// (sentinel-heartbeat.ts STALE_SUBMITTED_DISPATCH_MS) 对齐：默认 15 分钟 staleness 阈值，
// 防止刚派出去、worker 还没起来/正在原生 resume 的在途任务被误杀。
export const ORPHAN_DISPATCH_CANCEL_REASON = 'orphan-submitted: worker stopped without reporting'
export const ORPHAN_QUEUED_DISPATCH_CANCEL_REASON =
  'orphan-queued: dispatch was never submitted before runtime restart'
const ORPHAN_SUBMITTED_STALE_MS = 15 * 60 * 1000

export interface ReportTaskResult {
  dispatch: DispatchRecord | null
  forwardError: string | null
  forwarded: boolean
}

export interface RecoverTaskResult {
  dispatch: DispatchRecord
  forwardError: string | null
  forwarded: boolean
}

export interface AbandonTaskResult {
  dispatch: DispatchRecord
}

const reportForwardErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const forwardFailureSystemEvent = (input: {
  dispatchId: string | null
  error: string
  operation: 'cancel' | 'recover' | 'report' | 'status'
  workerName: string
}) =>
  JSON.stringify({
    dispatch_id: input.dispatchId,
    error: input.error,
    operation: input.operation,
    severity: 'error',
    text: `${input.workerName} ${input.operation} 已记录，但 Orchestrator 没收到：${input.error}`,
    type: 'orchestrator_forward_failed',
    worker_name: input.workerName,
  })

const queuedDispatchReconcileBlockedSystemEvent = (input: {
  dispatchId: string
  reason: string
  workerName: string
}) =>
  JSON.stringify({
    dispatch_id: input.dispatchId,
    reason: input.reason,
    severity: 'warning',
    text: `${input.workerName} 有一条 queued dispatch 启动恢复失败：${input.reason}`,
    type: 'queued_dispatch_reconcile_blocked',
    worker_name: input.workerName,
  })

const queuedDispatchProjectionFailedSystemEvent = (input: {
  dispatchId: string
  error: string
  workerName: string
}) =>
  JSON.stringify({
    dispatch_id: input.dispatchId,
    error: input.error,
    severity: 'warning',
    text: `${input.workerName} queued dispatch 已交付，但本地 tasks.md 投影失败：${input.error}`,
    type: 'queued_dispatch_projection_failed',
    worker_name: input.workerName,
  })

const noopTasksFileService: Pick<
  TasksFileService,
  | 'recordDispatchCancelled'
  | 'recordDispatchDone'
  | 'recordDispatchRolledBack'
  | 'recordDispatchSent'
> = {
  recordDispatchCancelled: () => {},
  recordDispatchDone: () => {},
  recordDispatchRolledBack: () => {},
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
  markDispatchOrphaned,
  markDispatchReportedByWorker,
  markDispatchSubmitted,
  mobilePushService,
  onMobileUserInput,
  runDbTransaction = (mutation) => mutation(),
  tasksFileService = noopTasksFileService,
  workspaceStore,
  findDispatchById,
  setReviewStatus,
  applyAcceptVerdict,
  linkReviewsDispatchId,
  clearReviewStatus,
  resolveCommandPresetId,
  listAllWorkspaceDispatches,
  reconcileAgentStatus,
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

  const surfaceOrchestratorForwardFailure = (
    workspaceId: string,
    input: {
      dispatchId: string | null
      error: string
      operation: 'cancel' | 'recover' | 'report' | 'status'
      workerName: string
    }
  ) => {
    insertMobileChatMessage?.(
      workspaceId,
      'outbound',
      'system_event',
      forwardFailureSystemEvent(input)
    )
    const notifyForwardFailure = mobilePushService?.notifyOrchestratorForwardFailure
    if (!notifyForwardFailure) return
    void notifyForwardFailure(workspaceId, input).catch((error) => {
      console.error('[hive] swallowed:orchestratorForwardFailure.push', error)
    })
  }

  const workerDispatchReservations = new Set<string>()

  const withWorkerDispatchReservation = <T>(
    workspaceId: string,
    workerId: string,
    mutation: () => T
  ): T => {
    const lockKey = `${workspaceId}:${workerId}`
    if (workerDispatchReservations.has(lockKey)) {
      throw new ConflictError(`Worker already has a dispatch reservation in progress: ${workerId}`)
    }
    workerDispatchReservations.add(lockKey)
    try {
      return mutation()
    } finally {
      workerDispatchReservations.delete(lockKey)
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
      const start = agentRuntime.startAgent(
        workspaceStore.getWorkspaceSnapshot(workspaceId).summary,
        workerId,
        { hivePort }
      )
      reconcileAgentStatus?.(workspaceId, workerId)
      const run = await start
      if (run.status === 'error') {
        workspaceStore.markAgentStopped(workspaceId, workerId)
        reconcileAgentStatus?.(workspaceId, workerId)
        throw new ConflictError(`${config.command} failed to start`)
      }
      reconcileAgentStatus?.(workspaceId, workerId)
    } catch (error) {
      workspaceStore.markAgentStopped(workspaceId, workerId)
      reconcileAgentStatus?.(workspaceId, workerId)
      throw error
    }
  }

  const dispatchTask = async (
    workspaceId: string,
    workerId: string,
    text: string,
    input: DispatchTaskInput = {}
  ) => {
    const worker = workspaceStore.getWorker(workspaceId, workerId)
    let messageHandle: MessageLogHandle | undefined
    let dispatch: DispatchRecord | undefined

    try {
      const reservation = withWorkerDispatchReservation(workspaceId, workerId, () => {
        const existingOpenDispatch = listOpenDispatchesForWorkspace(workspaceId).find(
          (candidate) => candidate.toAgentId === workerId && isOpenDispatchStatus(candidate.status)
        )
        if (existingOpenDispatch) {
          console.warn(
            [
              'team dispatch rejected: worker already has open dispatch',
              `worker=${worker.name}`,
              `worker_id=${workerId}`,
              `existing_dispatch_id=${existingOpenDispatch.id}`,
              `existing_dispatch_status=${existingOpenDispatch.status}`,
              `attempt_summary=${text.trim().split(/\r?\n/u)[0]?.slice(0, 160) ?? ''}`,
            ].join(' ')
          )
          throw new ConflictError(
            `Worker ${worker.name} already has open dispatch ${existingOpenDispatch.id}; cancel it before sending another task`
          )
        }

        const message = createSendMessage(workspaceId, workerId, text, input.fromAgentId)
        const handle = insertMessage(message)
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
          return {
            dispatch: createDispatch(dispatchInput),
            messageHandle: handle,
          }
        } catch (error) {
          deleteMessage(handle)
          throw error
        }
      })
      dispatch = reservation.dispatch
      messageHandle = reservation.messageHandle
      reconcileAgentStatus?.(workspaceId, workerId)

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
          cockpitSnapshot,
          { workflowAllowed: promptWorker.workflowAllowed }
        )
      }

      workspaceStore.markTaskDispatched(workspaceId, workerId)
      reconcileAgentStatus?.(workspaceId, workerId)
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
      if (dispatch) {
        deleteDispatch(dispatch.id)
        reconcileAgentStatus?.(workspaceId, workerId)
        const workspacePath = getWorkspacePath(workspaceId)
        if (workspacePath) {
          try {
            tasksFileService.recordDispatchRolledBack?.(workspacePath, { dispatchId: dispatch.id })
          } catch (rollbackError) {
            console.error('[hive] swallowed:teamDispatch.tasksRollback', rollbackError)
          }
        }
      }
      if (messageHandle) {
        deleteMessage(messageHandle)
      }
      throw error
    }
  }

  // 判定一条 open dispatch 是否是「可安全收尾」的孤儿。只收明确孤儿：
  // running/report_overdue + 已过 staleness 阈值 + 无 active run + （worker 已删 或 status==='stopped'）。
  // worker 还在 working/idle（在途，可能正在做或马上 report）一律不动。
  const isReconcilableOrphan = (
    workspaceId: string,
    dispatch: DispatchRecord,
    now: number,
    staleMs: number
  ) => {
    if (!isActiveDispatchStatus(dispatch.status) || dispatch.submittedAt === null) return false
    if (now - dispatch.submittedAt < staleMs) return false
    // 在途保护：worker 还有 active run = 合法在途，绝不收尾。
    if (agentRuntime.getActiveRunByAgentId?.(workspaceId, dispatch.toAgentId)) return false
    // worker 已被删除 = 明确孤儿；否则必须是 stopped 态才算孤儿。
    if (!workspaceStore.hasAgent(workspaceId, dispatch.toAgentId)) return true
    return workspaceStore.getWorker(workspaceId, dispatch.toAgentId).status === 'stopped'
  }

  const requireReportOverdueDispatch = (workspaceId: string, dispatchId: string) => {
    const dispatch = findOpenDispatchById(workspaceId, dispatchId)
    if (!dispatch) {
      throw new ConflictError(`No open dispatch: ${dispatchId}`)
    }
    if (dispatch.status !== 'report_overdue') {
      throw new ConflictError(
        `Dispatch ${dispatchId} is not report_overdue; current status=${dispatch.status}`
      )
    }
    return dispatch
  }

  const orphanQueuedDispatch = (
    workspaceId: string,
    dispatch: DispatchRecord,
    reason = ORPHAN_QUEUED_DISPATCH_CANCEL_REASON
  ): ReconcileQueuedDispatchesResult | null => {
    const orphaned = (markDispatchOrphaned ?? markDispatchCancelled)({
      dispatchId: dispatch.id,
      reason,
      workspaceId,
    })
    if (!orphaned) return null
    if (workspaceStore.hasAgent(workspaceId, orphaned.toAgentId)) {
      workspaceStore.markTaskCancelled(workspaceId, orphaned.toAgentId)
      reconcileAgentStatus?.(workspaceId, orphaned.toAgentId)
    }
    const workspacePath = getWorkspacePath(workspaceId)
    if (workspacePath) {
      tasksFileService.recordDispatchCancelled(workspacePath, {
        dispatchId: orphaned.id,
        reason,
      })
    }
    return { action: 'orphaned', dispatch: orphaned }
  }

  const surfaceQueuedDispatchReconcileBlocked = (
    workspaceId: string,
    dispatch: DispatchRecord,
    workerName: string,
    reason: string
  ) => {
    insertMobileChatMessage?.(
      workspaceId,
      'outbound',
      'system_event',
      queuedDispatchReconcileBlockedSystemEvent({
        dispatchId: dispatch.id,
        reason,
        workerName,
      })
    )
  }

  const surfaceQueuedDispatchProjectionFailed = (
    workspaceId: string,
    dispatch: DispatchRecord,
    workerName: string,
    error: unknown
  ) => {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[hive] queued dispatch projection failed after delivery', {
      dispatchId: dispatch.id,
      error: message,
      workspaceId,
      workerName,
    })
    insertMobileChatMessage?.(
      workspaceId,
      'outbound',
      'system_event',
      queuedDispatchProjectionFailedSystemEvent({
        dispatchId: dispatch.id,
        error: message,
        workerName,
      })
    )
  }

  const resubmitQueuedDispatch = async (
    workspaceId: string,
    dispatch: DispatchRecord,
    input: ReconcileQueuedDispatchesInput
  ): Promise<ReconcileQueuedDispatchesResult | null> => {
    if (!workspaceStore.hasAgent(workspaceId, dispatch.toAgentId)) {
      return orphanQueuedDispatch(workspaceId, dispatch)
    }
    const hasActiveRun = !!agentRuntime.getActiveRunByAgentId?.(workspaceId, dispatch.toAgentId)
    const hasLaunchConfig = !!agentRuntime.peekAgentLaunchConfig?.(workspaceId, dispatch.toAgentId)
    if (!hasActiveRun && !hasLaunchConfig) {
      const workerName = workspaceStore.getWorker(workspaceId, dispatch.toAgentId).name
      surfaceQueuedDispatchReconcileBlocked(
        workspaceId,
        dispatch,
        workerName,
        'worker has no active run or launch config'
      )
      return null
    }
    let promptWorker: ReturnType<WorkspaceStore['getWorker']>
    let workspacePath: string | null = null
    try {
      await ensureWorkerRun(workspaceId, dispatch.toAgentId, input.hivePort ?? '')
      promptWorker = workspaceStore.getWorker(workspaceId, dispatch.toAgentId)
      const senderName =
        dispatch.fromAgentId && workspaceStore.hasAgent(workspaceId, dispatch.fromAgentId)
          ? workspaceStore.getAgent(workspaceId, dispatch.fromAgentId).name
          : 'startup-reconcile'
      workspacePath = getWorkspacePath(workspaceId)
      const cockpitSnapshot = workspacePath
        ? buildWorkerCockpitSnapshot(parseCockpit(workspacePath))
        : undefined
      markDispatchSubmitted(dispatch.id)
      agentRuntime.writeSendPrompt(
        workspaceId,
        dispatch.toAgentId,
        dispatch.id,
        senderName,
        promptWorker.description,
        dispatch.text,
        cockpitSnapshot,
        { workflowAllowed: promptWorker.workflowAllowed }
      )
    } catch (error) {
      return orphanQueuedDispatch(
        workspaceId,
        dispatch,
        `${ORPHAN_QUEUED_DISPATCH_CANCEL_REASON}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
    try {
      workspaceStore.markTaskDispatched(workspaceId, dispatch.toAgentId)
      reconcileAgentStatus?.(workspaceId, dispatch.toAgentId)
    } catch (error) {
      surfaceQueuedDispatchProjectionFailed(workspaceId, dispatch, promptWorker.name, error)
    }
    if (workspacePath) {
      try {
        tasksFileService.recordDispatchSent(workspacePath, {
          dispatchId: dispatch.id,
          taskFirstLine: dispatch.text,
          workerName: promptWorker.name,
        })
      } catch (error) {
        surfaceQueuedDispatchProjectionFailed(workspaceId, dispatch, promptWorker.name, error)
      }
    }
    const submitted = findOpenDispatchById(workspaceId, dispatch.id) ?? {
      ...dispatch,
      status: 'running' as const,
      submittedAt: Date.now(),
    }
    return { action: 'submitted', dispatch: submitted }
  }

  return {
    async reconcileQueuedDispatchesOnStartup(input: ReconcileQueuedDispatchesInput = {}) {
      const workspaceIds = input.workspaceId
        ? [input.workspaceId]
        : workspaceStore.listWorkspaces().map((workspace) => workspace.id)
      const reconciled: ReconcileQueuedDispatchesResult[] = []
      for (const workspaceId of workspaceIds) {
        const queuedDispatches = listOpenDispatchesForWorkspace(workspaceId).filter(
          (dispatch) => dispatch.status === 'queued'
        )
        for (const dispatch of queuedDispatches) {
          const result = await resubmitQueuedDispatch(workspaceId, dispatch, input)
          if (result) reconciled.push(result)
        }
      }
      return reconciled
    },
    recoverTask(workspaceId: string, dispatchId: string, input: RecoverTaskInput) {
      workspaceStore.getAgent(workspaceId, input.fromAgentId)
      const dispatch = requireReportOverdueDispatch(workspaceId, dispatchId)
      workspaceStore.getWorker(workspaceId, dispatch.toAgentId)
      const activeRun = agentRuntime.getActiveRunByAgentId(workspaceId, dispatch.toAgentId)
      if (!activeRun) {
        throw new ConflictError(
          `Cannot recover dispatch ${dispatchId}: worker has no active run; start/stop the worker or use team abandon after confirming it stopped`
        )
      }
      try {
        agentRuntime.writeRecoveryReplayPrompt(workspaceId, dispatch.toAgentId, dispatch)
      } catch (error) {
        const forwardError = reportForwardErrorMessage(error)
        console.error('[hive] swallowed:teamRecover.forward', error)
        surfaceOrchestratorForwardFailure(workspaceId, {
          dispatchId: dispatch.id,
          error: forwardError,
          operation: 'recover',
          workerName: workspaceStore.getWorker(workspaceId, dispatch.toAgentId).name,
        })
        return {
          dispatch,
          forwardError,
          forwarded: false,
        }
      }
      return { dispatch, forwardError: null, forwarded: true }
    },
    abandonTask(workspaceId: string, dispatchId: string, input: AbandonTaskInput) {
      workspaceStore.getAgent(workspaceId, input.fromAgentId)
      if (input.confirmWorkerStopped !== true) {
        throw new ConflictError(
          'team abandon requires --confirm-worker-stopped after verifying the worker is stopped'
        )
      }
      const dispatch = requireReportOverdueDispatch(workspaceId, dispatchId)
      workspaceStore.getWorker(workspaceId, dispatch.toAgentId)
      const activeRun = agentRuntime.getActiveRunByAgentId(workspaceId, dispatch.toAgentId)
      if (activeRun) {
        throw new ConflictError(
          `Cannot abandon dispatch ${dispatchId}: worker still has an active run ${activeRun.runId}; use team recover or stop the worker first`
        )
      }
      const latestRun = agentRuntime.listAgentRuns(dispatch.toAgentId)[0]
      if (!latestRun || (latestRun.status !== 'exited' && latestRun.status !== 'error')) {
        throw new ConflictError(
          `Cannot abandon dispatch ${dispatchId}: worker stop is not confirmed by a terminal run record`
        )
      }
      const abandoned = markDispatchCancelled({
        dispatchId,
        reason: 'abandoned: worker stopped without report',
        workspaceId,
      })
      if (!abandoned) {
        throw new ConflictError(`No open dispatch: ${dispatchId}`)
      }
      workspaceStore.markTaskCancelled(workspaceId, abandoned.toAgentId)
      reconcileAgentStatus?.(workspaceId, abandoned.toAgentId)
      const workspacePath = getWorkspacePath(workspaceId)
      if (workspacePath) {
        tasksFileService.recordDispatchCancelled(workspacePath, {
          dispatchId: abandoned.id,
          reason: abandoned.reportText ?? 'abandoned',
        })
      }
      return { dispatch: abandoned }
    },
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
      reconcileAgentStatus?.(workspaceId, dispatch.toAgentId)
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
        surfaceOrchestratorForwardFailure(workspaceId, {
          dispatchId: dispatch.id,
          error: forwardError,
          operation: 'cancel',
          workerName: workspaceStore.getWorker(workspaceId, dispatch.toAgentId).name,
        })
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
          const cancelled = (markDispatchOrphaned ?? markDispatchCancelled)({
            dispatchId: dispatch.id,
            reason: ORPHAN_DISPATCH_CANCEL_REASON,
            workspaceId,
          })
          if (!cancelled) continue
          // worker 还在（只是 stopped）才更新它的 pending 计数；已删 worker 跳过。
          if (workspaceStore.hasAgent(workspaceId, cancelled.toAgentId)) {
            workspaceStore.markTaskCancelled(workspaceId, cancelled.toAgentId)
            reconcileAgentStatus?.(workspaceId, cancelled.toAgentId)
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
            surfaceOrchestratorForwardFailure(workspaceId, {
              dispatchId: null,
              error: forwardError,
              operation: 'status',
              workerName: worker.name,
            })
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
      if (input.requireDispatchId && !input.dispatchId) {
        throw new ConflictError(`Missing dispatch_id for worker report: ${worker.name}`)
      }
      const openDispatch = findOpenDispatch(workspaceId, workerId, input.dispatchId)
      if (!openDispatch && input.dispatchId) {
        throw new ConflictError(`No open dispatch for worker: ${worker.name}`)
      }
      if (!openDispatch) {
        throw new ConflictError(`No open dispatch for worker: ${worker.name}`)
      }
      // M43: reviewer 主路径 — 若调用方传了 --reviews + --verdict，必须三个 hook 都接好才有效。
      // gate=0 时即便传了也忽略，走旧路径。
      const acceptGateEnabled = isAcceptGateEnabled()
      const hasAcceptGateHooks =
        !!findDispatchById && !!setReviewStatus && !!applyAcceptVerdict && !!linkReviewsDispatchId
      const reviewerLinkRequested =
        acceptGateEnabled &&
        hasAcceptGateHooks &&
        typeof input.reviewsDispatchId === 'string' &&
        input.reviewsDispatchId.length > 0 &&
        input.verdict !== undefined
      if (reviewerLinkRequested) {
        if (!input.verdictReason?.trim()) {
          throw new BadRequestError('--verdict requires --reason')
        }
        if (worker.role !== 'reviewer') {
          throw new ConflictError(
            `Only reviewer-role worker can verdict another dispatch; current role=${worker.role}`
          )
        }
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
          // M43: reviewer 主路径 — 在被审 coder dispatch 上写 verdict + review_status。
          if (reviewerLinkRequested && input.reviewsDispatchId) {
            const coderDispatch = findDispatchById?.(workspaceId, input.reviewsDispatchId)
            if (!coderDispatch) {
              throw new ConflictError(
                `--reviews target dispatch not found in workspace: ${input.reviewsDispatchId}`
              )
            }
            if (!isCompletedDispatchStatus(coderDispatch.status)) {
              throw new ConflictError(
                `--reviews target dispatch is not reported yet: status=${coderDispatch.status}`
              )
            }
            // 钟馗审 High（顺手收）：被审 target 必须真在 accept-gate scope 内
            // （claude coder + 非 report-only），否则 reviewer 写 verdict 没意义。
            const coderPreset = resolveCommandPresetId?.(workspaceId, coderDispatch.toAgentId)
            const coderScopeInfo: WorkerScopeInfo = {
              ...(coderPreset !== undefined ? { commandPresetId: coderPreset } : {}),
            }
            try {
              const coderWorker = workspaceStore.getWorker(workspaceId, coderDispatch.toAgentId)
              coderScopeInfo.role = coderWorker.role
            } catch {
              // worker 已删；不写 role，下面 scope 校验自然拒。
            }
            if (!isDispatchInAcceptGateScope(coderDispatch, coderScopeInfo)) {
              throw new ConflictError(
                `--reviews target dispatch is out of accept-gate scope: role=${coderScopeInfo.role ?? 'unknown'} preset=${coderScopeInfo.commandPresetId ?? 'unknown'}`
              )
            }
            const verdict: AcceptVerdict = {
              verdict: input.verdict as ReviewStatus,
              byAgentId: workerId,
              at: Date.now(),
              reason: (input.verdictReason ?? '').trim(),
              reviewsDispatchId: reportedDispatch.id,
            }
            applyAcceptVerdict?.(coderDispatch.id, verdict)
            // 同时在 reviewer dispatch 上写 reviews_dispatch_id 精确指向被审 coder dispatch。
            linkReviewsDispatchId?.(reportedDispatch.id, coderDispatch.id)
            // 如果被审 coder dispatch 的 [~] 行需要根据新 verdict 重打 [x]/[~]，再调一次
            // recordDispatchDone（accepted/waived → [x]，rejected 保持 [~]）。在 transaction
            // 内调因为我们要保证 reviewer 写入与 tasks.md 行更新一起 commit。
            const workspacePathInner = getWorkspacePath(workspaceId)
            if (workspacePathInner) {
              tasksFileService.recordDispatchDone(workspacePathInner, {
                dispatchId: coderDispatch.id,
                reviewStatus: input.verdict ?? null,
              })
            }
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
          // M43: 本次 report 自身的 scope 判定 + 写 review_status='pending'（reviewer report 本体不入 scope）。
          if (acceptGateEnabled && hasAcceptGateHooks) {
            const preset = resolveCommandPresetId?.(workspaceId, workerId)
            const scopeInfo: WorkerScopeInfo = {
              role: worker.role,
              ...(preset !== undefined ? { commandPresetId: preset } : {}),
            }
            if (isDispatchInAcceptGateScope(reportedDispatch, scopeInfo)) {
              // worker re-report 路径：上一轮可能是 rejected，本轮重新进 pending（清掉 verdict）。
              clearReviewStatus?.(reportedDispatch.id)
              setReviewStatus?.(reportedDispatch.id, 'pending')
            }
          }
          return reportedDispatch
        })
        dbCommitted = true
        workspaceStore.markTaskReported(workspaceId, workerId)
        reconcileAgentStatus?.(workspaceId, workerId)
        const workspacePath = getWorkspacePath(workspaceId)
        if (workspacePath) {
          // M43: 本次自己的 dispatch 行打 [x]/[~]——scope 内 + gate 开 → [~]；其他 → [x]（旧路径）。
          const reviewStatusForLine =
            acceptGateEnabled && hasAcceptGateHooks
              ? (() => {
                  const preset = resolveCommandPresetId?.(workspaceId, workerId)
                  const scopeInfo: WorkerScopeInfo = {
                    role: worker.role,
                    ...(preset !== undefined ? { commandPresetId: preset } : {}),
                  }
                  return isDispatchInAcceptGateScope(dispatch, scopeInfo) ? 'pending' : null
                })()
              : null
          tasksFileService.recordDispatchDone(workspacePath, {
            dispatchId: dispatch.id,
            ...(reviewStatusForLine !== null ? { reviewStatus: reviewStatusForLine } : {}),
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
            surfaceOrchestratorForwardFailure(workspaceId, {
              dispatchId: dispatch.id,
              error: forwardError,
              operation: 'report',
              workerName: worker.name,
            })
          }
        } else {
          forwardError = 'Orchestrator PTY inactive, report recorded but not forwarded'
          surfaceOrchestratorForwardFailure(workspaceId, {
            dispatchId: dispatch.id,
            error: forwardError,
            operation: 'report',
            workerName: worker.name,
          })
        }
        return { dispatch, forwardError, forwarded }
      } catch (error) {
        if (!dbCommitted && messageHandle) deleteMessage(messageHandle)
        throw error
      }
    },
    // M43 旁路 — PM orchestrator 显式 accept；强制 --reason 引用 reviewer dispatch_id 以守 PM 自审反铁律。
    acceptTask(workspaceId: string, input: AcceptTaskInput): AcceptTaskResult {
      if (!isAcceptGateEnabled()) {
        throw new ConflictError('Accept gate disabled (HIVE_ACCEPT_GATE != 1)')
      }
      if (!findDispatchById || !applyAcceptVerdict) {
        throw new ConflictError('Accept gate hooks unavailable')
      }
      const trimmedReason = (input.reason ?? '').trim()
      if (!trimmedReason) {
        throw new BadRequestError('--reason is required for team accept')
      }
      // 设计守则：PM accept 必须引用 reviewer dispatch_id（防 PM 跳过 reviewer 自审 claude code）。
      // 强校验：reason 里至少出现一个 8 位 hex 子串 + 该子串能在 workspace dispatches 里找到一条
      // reviewer dispatch（toAgentId 角色是 reviewer）。
      const matches = trimmedReason.match(/\b[0-9a-f]{8,}\b/giu) ?? []
      if (matches.length === 0) {
        throw new BadRequestError(
          'team accept --reason must reference reviewer dispatch_id (8+ hex chars). PM 自审反铁律：必须引用钟馗或其他 reviewer 的 dispatch_id。'
        )
      }
      const coderDispatch = findDispatchById(workspaceId, input.dispatchId)
      if (!coderDispatch) {
        throw new ConflictError(`dispatch not found in workspace: ${input.dispatchId}`)
      }
      if (!isCompletedDispatchStatus(coderDispatch.status)) {
        throw new ConflictError(
          `dispatch not reported yet, cannot accept: status=${coderDispatch.status}`
        )
      }
      // 校验 reason 引用的 hex 至少有一条命中本 workspace 内 reviewer-role dispatch。
      // 必须扫全量 dispatches（reviewer 通常已 reported，不在 open list）。
      //
      // 钟馗审 blocking #1（安全命门）：单查"reviewer dispatch 存在"会让 PM 给 reviewer 派
      // 一条还没 report 的 dispatch、然后在 --reason 里引这个 id → 绕过 PM 自审反铁律。
      // 必须三重校验：
      // ① reviewer dispatch 真 reported（isCompletedDispatchStatus）
      // ② reviewer 的 report 时间晚于被审 coder（毫秒粒度 ms > coder 或同 ms 时 sequence 严格大于）
      // ③ reviewer dispatch 若已设 reviewsDispatchId，必须 == 当前 coderDispatch.id（不能引"审别条 coder"的 reviewer）
      //
      // 钟馗第二轮 blocking #1：同毫秒绕过——`>=` 放过同毫秒落库的 reviewer，
      // 而 SQLite 写入毫秒精度时 reviewer/coder 完全可能落在同一毫秒。
      // 修法：用 dispatch.sequence（INTEGER PRIMARY KEY AUTOINCREMENT，单调递增）作 tie-break：
      // 严格大于 coder.sequence 才算"审在 coder 之后"。
      const coderReportedAt = coderDispatch.reportedAt
      const coderSequence = coderDispatch.sequence
      if (coderReportedAt === null) {
        throw new ConflictError('coder dispatch has no reportedAt; accept gate invariant broken')
      }
      if (coderSequence === null) {
        throw new ConflictError('coder dispatch has no sequence; accept gate invariant broken')
      }
      const allDispatches = listAllWorkspaceDispatches?.(workspaceId) ?? []
      let referencedReviewer = false
      let lastRejectReason: string | null = null
      for (const hex of matches) {
        const lower = hex.toLowerCase()
        const candidates =
          lower.length === 36
            ? allDispatches.filter((d) => d.id.toLowerCase() === lower)
            : allDispatches.filter((d) => d.id.toLowerCase().startsWith(lower))
        for (const candidate of candidates) {
          let refRole: string | undefined
          try {
            refRole = workspaceStore.getWorker(workspaceId, candidate.toAgentId).role
          } catch {
            // worker 已删/不存在，忽略此 candidate。
            continue
          }
          if (refRole !== 'reviewer') continue
          // ① reviewer 必须真 report 过
          if (!isCompletedDispatchStatus(candidate.status)) {
            lastRejectReason = `referenced reviewer dispatch ${candidate.id} has not reported yet (status=${candidate.status})`
            continue
          }
          // ② reviewer 必须严格"审在 coder 之后"——毫秒 > 或同毫秒时 sequence 严格 > coder.sequence。
          //    单 `>=` 放过同毫秒落库的 reviewer，反铁律最后一道缝。
          if (candidate.reportedAt === null || candidate.sequence === null) {
            lastRejectReason = `referenced reviewer dispatch ${candidate.id} missing reportedAt/sequence`
            continue
          }
          const tiePasses =
            candidate.reportedAt > coderReportedAt ||
            (candidate.reportedAt === coderReportedAt && candidate.sequence > coderSequence)
          if (!tiePasses) {
            lastRejectReason = `referenced reviewer dispatch ${candidate.id} did not report strictly after coder dispatch (reviewer_reported_at=${candidate.reportedAt}/seq=${candidate.sequence} coder_reported_at=${coderReportedAt}/seq=${coderSequence})`
            continue
          }
          // ③ reviewer 若已显式 link 别条 coder，必须 == 本 coder
          if (
            candidate.reviewsDispatchId !== null &&
            candidate.reviewsDispatchId !== coderDispatch.id
          ) {
            lastRejectReason = `referenced reviewer dispatch ${candidate.id} is linked to a different coder dispatch (reviews_dispatch_id=${candidate.reviewsDispatchId})`
            continue
          }
          referencedReviewer = true
          break
        }
        if (referencedReviewer) break
      }
      if (!referencedReviewer) {
        throw new BadRequestError(
          `team accept --reason 引用的 dispatch_id 未能定位到一条合法 reviewer-role dispatch（必须：reviewer 已 reported + 报告时间晚于 coder 报告时间 + 显式 link 时必须 link 本 coder）；守 PM 自审反铁律${lastRejectReason ? ` · last reject: ${lastRejectReason}` : ''}`
        )
      }
      const verdictValue: 'accepted' | 'waived' = input.verdict ?? 'accepted'
      const verdict: AcceptVerdict = {
        verdict: verdictValue,
        byAgentId: input.fromAgentId,
        at: Date.now(),
        reason: trimmedReason,
      }
      runDbTransaction(() => {
        applyAcceptVerdict(input.dispatchId, verdict)
      })
      const workspacePath = getWorkspacePath(workspaceId)
      if (workspacePath) {
        tasksFileService.recordDispatchDone(workspacePath, {
          dispatchId: input.dispatchId,
          reviewStatus: verdictValue,
        })
      }
      const updated = findDispatchById(workspaceId, input.dispatchId)
      if (!updated) {
        throw new ConflictError('dispatch disappeared after accept; concurrent mutation?')
      }
      return { dispatch: updated }
    },
  }
}

// 让 TS 知道 isAcceptGateEnabled 和 VERDICT_REASON_REVIEWER_REFERENCE_PATTERN 不被任何 export 引用没问题。
void VERDICT_REASON_REVIEWER_REFERENCE_PATTERN
