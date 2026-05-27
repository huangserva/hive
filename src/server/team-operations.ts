import { existsSync, statSync } from 'node:fs'

import type { AgentRuntime } from './agent-runtime.js'
import { buildWorkerCockpitSnapshot } from './agent-stdin-dispatcher.js'
import { parseCockpit } from './cockpit-doc.js'
import type { DispatchRecord } from './dispatch-ledger-store.js'
import { ConflictError } from './http-errors.js'
import type { MessageLogHandle, MessageLogRecord } from './message-log-store.js'
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
  tasksFileService?: Pick<
    TasksFileService,
    'recordDispatchCancelled' | 'recordDispatchDone' | 'recordDispatchSent'
  >
  workspaceStore: WorkspaceStore
}

export interface DispatchTaskInput {
  fromAgentId?: string
  hivePort?: string
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
  markDispatchCancelled,
  markDispatchReportedByWorker,
  markDispatchSubmitted,
  mobilePushService,
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

      if (input.fromAgentId) {
        const sender = workspaceStore.getAgent(workspaceId, input.fromAgentId)
        await ensureWorkerRun(workspaceId, workerId, input.hivePort ?? '')
        const worker = workspaceStore.getWorker(workspaceId, workerId)
        const workspacePath = getWorkspacePath(workspaceId)
        const cockpitSnapshot = workspacePath
          ? buildWorkerCockpitSnapshot(parseCockpit(workspacePath))
          : undefined
        markDispatchSubmitted(dispatch.id)
        agentRuntime.writeSendPrompt(
          workspaceId,
          workerId,
          dispatch.id,
          sender.name,
          worker.description,
          text,
          cockpitSnapshot
        )
      }

      workspaceStore.markTaskDispatched(workspaceId, workerId)
      const worker = workspaceStore.getWorker(workspaceId, workerId)
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
      return dispatch
    } catch (error) {
      if (dispatch) deleteDispatch(dispatch.id)
      deleteMessage(messageHandle)
      throw error
    }
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
    recordUserInput(workspaceId: string, orchestratorId: string, text: string) {
      workspaceStore.getAgent(workspaceId, orchestratorId)
      agentRuntime.writeUserInputPrompt(workspaceId, text)
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
      const messageHandle = insertMessage(
        createReportMessage(workspaceId, workerId, text, status, artifacts)
      )
      try {
        const dispatch = markDispatchReportedByWorker({
          artifacts,
          ...(input.dispatchId ? { dispatchId: input.dispatchId } : {}),
          reportText: text,
          toAgentId: workerId,
          workspaceId,
        })
        if (!dispatch) {
          throw new ConflictError(`No open dispatch for worker: ${worker.name}`)
        }
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
        deleteMessage(messageHandle)
        throw error
      }
    },
  }
}
