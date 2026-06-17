import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  type DispatchRecord,
  isCompletedDispatchStatus,
} from '../../src/server/dispatch-ledger-store.js'
import { buildMobileWorkspaceTasks } from '../../src/server/routes-mobile.js'
import { createRuntimeStore } from '../../src/server/runtime-store.js'
import { createTeamOperations } from '../../src/server/team-operations.js'

afterEach(() => {
  vi.restoreAllMocks()
})

const withDispatchDefaults = (
  dispatch: Omit<DispatchRecord, 'acceptVerdict' | 'reviewStatus' | 'reviewsDispatchId'> &
    Partial<Pick<DispatchRecord, 'acceptVerdict' | 'reviewStatus' | 'reviewsDispatchId'>>
): DispatchRecord => ({
  acceptVerdict: null,
  reviewStatus: null,
  reviewsDispatchId: null,
  ...dispatch,
})

describe('team atomicity', () => {
  test('dispatchTask does not bump pending count when message insert fails before PTY write', async () => {
    const store = createRuntimeStore()
    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')
    const worker = store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
    const orchestrator = store.getWorkspaceSnapshot(workspace.id).agents[0]
    if (!orchestrator) {
      throw new Error('Expected orchestrator')
    }
    const insertMessage = vi.fn(() => {
      throw new Error('insert message failed')
    })
    const createDispatch = vi.fn()
    const deleteDispatch = vi.fn()
    const deleteMessage = vi.fn()
    const writeSendPrompt = vi.fn()
    const markTaskDispatched = vi.fn()
    const ops = createTeamOperations({
      agentRuntime: {
        writeSendPrompt,
        writeReportPrompt: vi.fn(),
        writeUserInputPrompt: vi.fn(),
      } as never,
      createDispatch,
      deleteDispatch,
      deleteMessage,
      findOpenDispatch: vi.fn(),
      findOpenDispatchById: vi.fn(),
      insertMessage,
      listOpenDispatchesForWorkspace: vi.fn((): DispatchRecord[] => []),
      markDispatchCancelled: vi.fn(),
      markDispatchReportedByWorker: vi.fn(),
      markDispatchSubmitted: vi.fn(),
      workspaceStore: {
        getAgent: store.getAgent,
        getWorker: store.getWorker,
        getWorkerByName: (workspaceId: string, workerName: string) => {
          const worker = store
            .getWorkspaceSnapshot(workspaceId)
            .agents.find((agent) => agent.name === workerName && agent.role !== 'orchestrator')
          if (!worker) {
            throw new Error(`Worker not found: ${workerName}`)
          }
          return worker
        },
        markTaskDispatched,
        markTaskReported: vi.fn(),
      } as never,
    })

    await expect(
      ops.dispatchTask(workspace.id, worker.id, 'Implement login', { fromAgentId: orchestrator.id })
    ).rejects.toThrow(/insert message failed/)

    expect(store.listWorkers(workspace.id)).toContainEqual(
      expect.objectContaining({
        id: worker.id,
        pendingTaskCount: 0,
        status: 'stopped',
      })
    )
    expect(store.listMessagesForRecovery(workspace.id, 0)).toEqual([])
    expect(writeSendPrompt).not.toHaveBeenCalled()
    expect(insertMessage).toHaveBeenCalledTimes(1)
    expect(createDispatch).not.toHaveBeenCalled()
    expect(deleteMessage).not.toHaveBeenCalled()
    expect(deleteDispatch).not.toHaveBeenCalled()
    expect(markTaskDispatched).not.toHaveBeenCalled()
  })

  test('dispatchTask deletes dispatch ledger record when worker start fails', async () => {
    const store = createRuntimeStore()
    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')
    const worker = store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
    const orchestrator = store.getWorkspaceSnapshot(workspace.id).agents[0]
    if (!orchestrator) {
      throw new Error('Expected orchestrator')
    }
    const dispatch = withDispatchDefaults({
      artifacts: [],
      createdAt: Date.now(),
      deliveredAt: null,
      fromAgentId: orchestrator.id,
      id: 'dispatch-1',
      reportedAt: null,
      reportText: null,
      sequence: 1,
      status: 'queued',
      submittedAt: null,
      text: 'Implement login',
      toAgentId: worker.id,
      workspaceId: workspace.id,
    })
    const deleteDispatch = vi.fn()
    const deleteMessage = vi.fn()

    const ops = createTeamOperations({
      agentRuntime: {
        getActiveRunByAgentId: vi.fn(() => undefined),
        peekAgentLaunchConfig: vi.fn(() => undefined),
        writeReportPrompt: vi.fn(),
        writeSendPrompt: vi.fn(),
        writeUserInputPrompt: vi.fn(),
      } as never,
      createDispatch: vi.fn(() => dispatch),
      deleteDispatch,
      deleteMessage,
      findOpenDispatch: vi.fn(),
      findOpenDispatchById: vi.fn(),
      insertMessage: vi.fn(() => ({ sequence: 1 })),
      listOpenDispatchesForWorkspace: vi.fn((): DispatchRecord[] => []),
      markDispatchCancelled: vi.fn(),
      markDispatchReportedByWorker: vi.fn(),
      markDispatchSubmitted: vi.fn(),
      workspaceStore: {
        ...store,
        markAgentStarted: vi.fn(),
        markAgentStopped: vi.fn(),
      } as never,
    })

    await expect(
      ops.dispatchTask(workspace.id, worker.id, 'Implement login', { fromAgentId: orchestrator.id })
    ).rejects.toThrow(/No worker launch config available/)

    expect(deleteDispatch).toHaveBeenCalledWith(dispatch.id)
    expect(deleteMessage).toHaveBeenCalledWith({ sequence: 1 })
    expect(store.listWorkers(workspace.id)).toContainEqual(
      expect.objectContaining({
        id: worker.id,
        pendingTaskCount: 0,
        status: 'stopped',
      })
    )
  })

  test('dispatchTask revalidates worker after startup before writing stdin', async () => {
    const store = createRuntimeStore()
    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')
    const worker = store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
    const orchestrator = store.getWorkspaceSnapshot(workspace.id).agents[0]
    if (!orchestrator) {
      throw new Error('Expected orchestrator')
    }
    const dispatch = withDispatchDefaults({
      artifacts: [],
      createdAt: Date.now(),
      deliveredAt: null,
      fromAgentId: orchestrator.id,
      id: 'dispatch-1',
      reportedAt: null,
      reportText: null,
      sequence: 1,
      status: 'queued',
      submittedAt: null,
      text: 'Implement login',
      toAgentId: worker.id,
      workspaceId: workspace.id,
    })
    const deleteDispatch = vi.fn()
    const deleteMessage = vi.fn()
    const markDispatchSubmitted = vi.fn()
    const writeSendPrompt = vi.fn()

    const ops = createTeamOperations({
      agentRuntime: {
        getActiveRunByAgentId: vi.fn(() => undefined),
        peekAgentLaunchConfig: vi.fn(() => ({ command: 'node' })),
        startAgent: vi.fn(async () => {
          store.deleteWorker(workspace.id, worker.id)
          return { status: 'running' }
        }),
        writeReportPrompt: vi.fn(),
        writeSendPrompt,
        writeUserInputPrompt: vi.fn(),
      } as never,
      createDispatch: vi.fn(() => dispatch),
      deleteDispatch,
      deleteMessage,
      findOpenDispatch: vi.fn(),
      findOpenDispatchById: vi.fn(),
      insertMessage: vi.fn(() => ({ sequence: 1 })),
      listOpenDispatchesForWorkspace: vi.fn((): DispatchRecord[] => []),
      markDispatchCancelled: vi.fn(),
      markDispatchReportedByWorker: vi.fn(),
      markDispatchSubmitted,
      workspaceStore: {
        ...store,
        markAgentStarted: vi.fn(),
        markAgentStopped: vi.fn(),
      } as never,
    })

    await expect(
      ops.dispatchTask(workspace.id, worker.id, 'Implement login', { fromAgentId: orchestrator.id })
    ).rejects.toThrow(/Agent not found|Worker not found/)

    expect(writeSendPrompt).not.toHaveBeenCalled()
    expect(markDispatchSubmitted).not.toHaveBeenCalled()
    expect(deleteDispatch).toHaveBeenCalledWith(dispatch.id)
    expect(deleteMessage).toHaveBeenCalledWith({ sequence: 1 })
  })

  test('dispatchTask rejects a concurrent second task while the first dispatch is still queued', async () => {
    const store = createRuntimeStore()
    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')
    const worker = store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
    const orchestrator = store.getWorkspaceSnapshot(workspace.id).agents[0]
    if (!orchestrator) {
      throw new Error('Expected orchestrator')
    }

    const dispatches: DispatchRecord[] = []
    const createDispatch = vi.fn(
      (input: { fromAgentId?: string; text: string; toAgentId: string; workspaceId: string }) => {
        const dispatch = withDispatchDefaults({
          artifacts: [],
          createdAt: Date.now(),
          deliveredAt: null,
          fromAgentId: input.fromAgentId ?? null,
          id: `dispatch-${dispatches.length + 1}`,
          reportedAt: null,
          reportText: null,
          sequence: dispatches.length + 1,
          status: 'queued',
          submittedAt: null,
          text: input.text,
          toAgentId: input.toAgentId,
          workspaceId: input.workspaceId,
        })
        dispatches.push(dispatch)
        return dispatch
      }
    )
    const listOpenDispatchesForWorkspace = vi.fn((workspaceId: string) =>
      dispatches.filter(
        (dispatch) =>
          dispatch.workspaceId === workspaceId && !isCompletedDispatchStatus(dispatch.status)
      )
    )
    const markDispatchSubmitted = vi.fn((dispatchId: string) => {
      const dispatch = dispatches.find((candidate) => candidate.id === dispatchId)
      if (!dispatch) {
        throw new Error(`Missing dispatch: ${dispatchId}`)
      }
      dispatch.status = 'running'
      dispatch.submittedAt = Date.now()
    })
    let resolveStartAgent: ((run: { status: 'running' }) => void) | undefined
    const startAgentReady = new Promise<{ status: 'running' }>((resolve) => {
      resolveStartAgent = resolve
    })
    const writeSendPrompt = vi.fn()

    const ops = createTeamOperations({
      agentRuntime: {
        getActiveRunByAgentId: vi.fn(() => undefined),
        peekAgentLaunchConfig: vi.fn(() => ({ command: 'node' })),
        startAgent: vi.fn(() => startAgentReady),
        writeReportPrompt: vi.fn(),
        writeSendPrompt,
        writeUserInputPrompt: vi.fn(),
      } as never,
      createDispatch,
      deleteDispatch: vi.fn((dispatchId: string) => {
        const index = dispatches.findIndex((dispatch) => dispatch.id === dispatchId)
        if (index >= 0) dispatches.splice(index, 1)
      }),
      deleteMessage: vi.fn(),
      findOpenDispatch: vi.fn(),
      findOpenDispatchById: vi.fn(),
      insertMessage: vi.fn(() => ({ sequence: 1 })),
      listOpenDispatchesForWorkspace,
      markDispatchCancelled: vi.fn(),
      markDispatchReportedByWorker: vi.fn(),
      markDispatchSubmitted,
      workspaceStore: {
        getAgent: store.getAgent,
        getWorker: store.getWorker,
        getWorkspaceSnapshot: store.getWorkspaceSnapshot,
        markAgentStarted: vi.fn(),
        markAgentStopped: vi.fn(),
        markTaskDispatched: vi.fn(),
        markTaskReported: vi.fn(),
      } as never,
    })

    const firstDispatch = ops.dispatchTask(workspace.id, worker.id, 'First task', {
      fromAgentId: orchestrator.id,
    })
    await vi.waitFor(() => {
      expect(dispatches).toHaveLength(1)
      expect(dispatches[0]).toMatchObject({ status: 'queued', text: 'First task' })
    })

    const secondDispatch = ops.dispatchTask(workspace.id, worker.id, 'Second task', {
      fromAgentId: orchestrator.id,
    })
    await Promise.resolve()
    expect(createDispatch).toHaveBeenCalledTimes(1)
    await expect(secondDispatch).rejects.toThrow(/already has open dispatch dispatch-1/)
    expect(dispatches).toHaveLength(1)

    if (!resolveStartAgent) {
      throw new Error('Expected startAgent resolver')
    }
    resolveStartAgent({ status: 'running' })
    await expect(firstDispatch).resolves.toMatchObject({ id: 'dispatch-1', text: 'First task' })
    expect(writeSendPrompt).toHaveBeenCalledTimes(1)

    const completedDispatch = dispatches[0]
    if (!completedDispatch) {
      throw new Error('Expected first dispatch')
    }
    completedDispatch.status = 'completed'

    await expect(
      ops.dispatchTask(workspace.id, worker.id, 'Third task', { fromAgentId: orchestrator.id })
    ).resolves.toMatchObject({ id: 'dispatch-2', text: 'Third task' })
    expect(createDispatch).toHaveBeenCalledTimes(2)
  })

  test('reportTask with requireActiveRun closes dispatch and reconciles stopped when worker has no active run', () => {
    const store = createRuntimeStore()
    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')
    const worker = store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
    store.getWorker(workspace.id, worker.id).status = 'idle'

    store.dispatchTask(workspace.id, worker.id, 'Implement login')
    expect(store.listDispatches(workspace.id)).toContainEqual(
      expect.objectContaining({ status: 'queued', text: 'Implement login' })
    )
    const beforeMessages = store.listMessagesForRecovery(workspace.id, 0).length

    const result = store.reportTask(workspace.id, worker.id, {
      status: 'success',
      text: 'Done',
      requireActiveRun: true,
    })

    expect(store.listWorkers(workspace.id)).toContainEqual(
      expect.objectContaining({
        id: worker.id,
        pendingTaskCount: 0,
        status: 'stopped',
      })
    )
    expect(store.listMessagesForRecovery(workspace.id, 0).length).toBe(beforeMessages + 1)
    expect(store.listDispatches(workspace.id)).toContainEqual(
      expect.objectContaining({
        status: 'completed',
        text: 'Implement login',
        reportText: 'Done',
      })
    )
    expect(result.forwarded).toBe(false)
    expect(result.forwardError).toContain('Orchestrator PTY inactive')
  })

  test('legacy reported dispatch rows are still read as completed/done', () => {
    const legacyReported = withDispatchDefaults({
      artifacts: [],
      createdAt: Date.now(),
      deliveredAt: null,
      fromAgentId: null,
      id: 'legacy-reported',
      reportedAt: Date.now(),
      reportText: 'Done',
      sequence: 1,
      status: 'reported',
      submittedAt: Date.now(),
      text: 'Legacy report row',
      toAgentId: 'worker-1',
      workspaceId: 'workspace-1',
    })
    const completed = withDispatchDefaults({
      ...legacyReported,
      id: 'completed',
      sequence: 2,
      status: 'completed',
      text: 'Completed row',
      toAgentId: 'worker-2',
    })

    expect(isCompletedDispatchStatus('reported')).toBe(true)
    expect(isCompletedDispatchStatus('completed')).toBe(true)

    const tasks = buildMobileWorkspaceTasks(
      {
        getWorker: (_workspaceId: string, workerId: string) => ({
          id: workerId,
          name: workerId === 'worker-1' ? 'Alice' : 'Bob',
        }),
        listDispatches: () => [legacyReported, completed],
      } as never,
      'workspace-1'
    )

    expect(tasks.dispatches).toEqual([
      expect.objectContaining({ id: 'legacy-reported', status: 'done', worker_name: 'Alice' }),
      expect.objectContaining({ id: 'completed', status: 'done', worker_name: 'Bob' }),
    ])
  })

  test('reportTask does not write orchestrator stdin when dispatch ledger update fails', () => {
    const store = createRuntimeStore()
    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')
    const worker = store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
    const dispatch = withDispatchDefaults({
      artifacts: [],
      createdAt: Date.now(),
      deliveredAt: null,
      fromAgentId: `${workspace.id}:orchestrator`,
      id: 'dispatch-1',
      reportedAt: null,
      reportText: null,
      sequence: 1,
      status: 'queued',
      submittedAt: null,
      text: 'Implement login',
      toAgentId: worker.id,
      workspaceId: workspace.id,
    })
    const deleteMessage = vi.fn()
    const markTaskReported = vi.fn()
    const writeReportPrompt = vi.fn()

    const ops = createTeamOperations({
      agentRuntime: {
        getActiveRunByAgentId: vi.fn(() => ({ runId: 'run-1' })),
        writeReportPrompt,
        writeSendPrompt: vi.fn(),
        writeUserInputPrompt: vi.fn(),
      } as never,
      createDispatch: vi.fn(),
      deleteDispatch: vi.fn(),
      deleteMessage,
      findOpenDispatch: vi.fn(() => dispatch),
      findOpenDispatchById: vi.fn(),
      insertMessage: vi.fn(() => ({ sequence: 1 })),
      listOpenDispatchesForWorkspace: vi.fn((): DispatchRecord[] => []),
      markDispatchCancelled: vi.fn(),
      markDispatchReportedByWorker: vi.fn(() => {
        throw new Error('dispatch ledger failed')
      }),
      markDispatchSubmitted: vi.fn(),
      workspaceStore: {
        getWorker: store.getWorker,
        markTaskReported,
      } as never,
    })

    expect(() =>
      ops.reportTask(workspace.id, worker.id, {
        requireActiveRun: true,
        status: 'success',
        text: 'Done',
      })
    ).toThrow(/dispatch ledger failed/)

    expect(writeReportPrompt).not.toHaveBeenCalled()
    expect(markTaskReported).not.toHaveBeenCalled()
    expect(deleteMessage).toHaveBeenCalledWith({ sequence: 1 })
  })

  test('reportTask keeps the recorded report when orchestrator stdin forwarding fails', () => {
    const store = createRuntimeStore()
    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')
    const worker = store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
    const dispatch = withDispatchDefaults({
      artifacts: [],
      createdAt: Date.now(),
      deliveredAt: null,
      fromAgentId: `${workspace.id}:orchestrator`,
      id: 'dispatch-1',
      reportedAt: null,
      reportText: null,
      sequence: 1,
      status: 'queued',
      submittedAt: null,
      text: 'Implement login',
      toAgentId: worker.id,
      workspaceId: workspace.id,
    })
    const deleteMessage = vi.fn()
    const markDispatchReportedByWorker = vi.fn(
      (): DispatchRecord => ({ ...dispatch, status: 'completed' })
    )
    const markTaskReported = vi.fn()
    const reportForwardError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const insertMobileChatMessage = vi.fn()
    const notifyOrchestratorForwardFailure = vi.fn(async () => {})

    const ops = createTeamOperations({
      agentRuntime: {
        getActiveRunByAgentId: vi.fn(() => ({ runId: 'run-1' })),
        writeReportPrompt: vi.fn(() => {
          throw new Error('stdin write failed')
        }),
        writeSendPrompt: vi.fn(),
        writeUserInputPrompt: vi.fn(),
      } as never,
      createDispatch: vi.fn(),
      deleteDispatch: vi.fn(),
      deleteMessage,
      findOpenDispatch: vi.fn(() => dispatch),
      findOpenDispatchById: vi.fn(),
      insertMessage: vi.fn(() => ({ sequence: 1 })),
      insertMobileChatMessage,
      listOpenDispatchesForWorkspace: vi.fn((): DispatchRecord[] => []),
      markDispatchCancelled: vi.fn(),
      markDispatchReportedByWorker,
      markDispatchSubmitted: vi.fn(),
      mobilePushService: {
        notifyOrchestratorForwardFailure,
        notifyWorkerDone: vi.fn(async () => {}),
      },
      workspaceStore: {
        getWorker: store.getWorker,
        markTaskReported,
      } as never,
    })

    const result = ops.reportTask(workspace.id, worker.id, {
      requireActiveRun: true,
      status: 'success',
      text: 'Done',
    })

    expect(markDispatchReportedByWorker).toHaveBeenCalledWith({
      artifacts: [],
      reportText: 'Done',
      toAgentId: worker.id,
      workspaceId: workspace.id,
    })
    expect(markTaskReported).toHaveBeenCalledWith(workspace.id, worker.id)
    expect(deleteMessage).not.toHaveBeenCalled()
    expect(reportForwardError).toHaveBeenCalledWith(
      '[hive] swallowed:teamReport.forward',
      expect.any(Error)
    )
    expect(result).toEqual({
      dispatch: { ...dispatch, status: 'completed' },
      forwardError: 'stdin write failed',
      forwarded: false,
    })
    expect(insertMobileChatMessage).toHaveBeenCalledWith(
      workspace.id,
      'outbound',
      'system_event',
      expect.stringContaining('"type":"orchestrator_forward_failed"')
    )
    expect(insertMobileChatMessage).toHaveBeenCalledWith(
      workspace.id,
      'outbound',
      'system_event',
      expect.stringContaining('"operation":"report"')
    )
    expect(notifyOrchestratorForwardFailure).toHaveBeenCalledWith(
      workspace.id,
      expect.objectContaining({
        dispatchId: dispatch.id,
        error: 'stdin write failed',
        operation: 'report',
        workerName: 'Alice',
      })
    )
  })

  test('cancelTask and statusTask surface orchestrator forward failures to user', () => {
    const store = createRuntimeStore()
    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')
    const worker = store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
    const dispatch = withDispatchDefaults({
      artifacts: [],
      createdAt: Date.now(),
      deliveredAt: Date.now(),
      fromAgentId: `${workspace.id}:orchestrator`,
      id: 'dispatch-1',
      reportedAt: null,
      reportText: null,
      sequence: 1,
      status: 'running',
      submittedAt: Date.now(),
      text: 'Implement login',
      toAgentId: worker.id,
      workspaceId: workspace.id,
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const insertMobileChatMessage = vi.fn()
    const notifyOrchestratorForwardFailure = vi.fn(async () => {})
    const ops = createTeamOperations({
      agentRuntime: {
        writeCancelPrompt: vi.fn(() => {
          throw new Error('cancel forward failed')
        }),
        writeReportPrompt: vi.fn(),
        writeSendPrompt: vi.fn(),
        writeStatusPrompt: vi.fn(() => {
          throw new Error('status forward failed')
        }),
        writeUserInputPrompt: vi.fn(),
      } as never,
      createDispatch: vi.fn(),
      deleteDispatch: vi.fn(),
      deleteMessage: vi.fn(),
      findOpenDispatch: vi.fn(),
      findOpenDispatchById: vi.fn(() => dispatch),
      insertMessage: vi.fn(() => ({ sequence: 1 })),
      insertMobileChatMessage,
      listOpenDispatchesForWorkspace: vi.fn((): DispatchRecord[] => []),
      markDispatchCancelled: vi.fn(
        (): DispatchRecord => ({
          ...dispatch,
          reportText: 'cancelled',
          status: 'cancelled',
        })
      ),
      markDispatchReportedByWorker: vi.fn(),
      markDispatchSubmitted: vi.fn(),
      mobilePushService: {
        notifyOrchestratorForwardFailure,
        notifyWorkerDone: vi.fn(async () => {}),
      },
      workspaceStore: {
        getAgent: store.getAgent,
        getWorker: store.getWorker,
        markTaskCancelled: vi.fn(),
      } as never,
    })

    const cancelResult = ops.cancelTask(workspace.id, dispatch.id, {
      fromAgentId: `${workspace.id}:orchestrator`,
      reason: 'superseded',
    })
    const statusResult = ops.statusTask(workspace.id, worker.id, {
      requireActiveRun: true,
      text: 'Still working',
    })

    expect(cancelResult).toMatchObject({
      forwardError: 'cancel forward failed',
      forwarded: false,
    })
    expect(statusResult).toMatchObject({
      forwardError: 'status forward failed',
      forwarded: false,
    })
    expect(notifyOrchestratorForwardFailure).toHaveBeenCalledWith(
      workspace.id,
      expect.objectContaining({ dispatchId: dispatch.id, operation: 'cancel' })
    )
    expect(notifyOrchestratorForwardFailure).toHaveBeenCalledWith(
      workspace.id,
      expect.objectContaining({ dispatchId: null, operation: 'status' })
    )
    expect(insertMobileChatMessage).toHaveBeenCalledTimes(2)
  })

  test('reportTask sends a mobile push notification after a dispatch is reported', () => {
    const store = createRuntimeStore()
    const workspace = store.createWorkspace('/tmp/hive-alpha', 'Alpha')
    const worker = store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
    const dispatch = withDispatchDefaults({
      artifacts: [],
      createdAt: Date.now(),
      deliveredAt: null,
      fromAgentId: `${workspace.id}:orchestrator`,
      id: 'dispatch-1',
      reportedAt: null,
      reportText: null,
      sequence: 1,
      status: 'queued',
      submittedAt: null,
      text: 'Implement login',
      toAgentId: worker.id,
      workspaceId: workspace.id,
    })
    const notifyWorkerDone = vi.fn(async () => {})

    const ops = createTeamOperations({
      agentRuntime: {
        getActiveRunByAgentId: vi.fn(() => ({ runId: 'run-1' })),
        writeReportPrompt: vi.fn(),
        writeSendPrompt: vi.fn(),
        writeUserInputPrompt: vi.fn(),
      } as never,
      createDispatch: vi.fn(),
      deleteDispatch: vi.fn(),
      deleteMessage: vi.fn(),
      findOpenDispatch: vi.fn(() => dispatch),
      findOpenDispatchById: vi.fn(),
      insertMessage: vi.fn(() => ({ sequence: 1 })),
      listOpenDispatchesForWorkspace: vi.fn((): DispatchRecord[] => []),
      markDispatchCancelled: vi.fn(),
      markDispatchReportedByWorker: vi.fn(
        (): DispatchRecord => ({
          ...dispatch,
          reportedAt: Date.now(),
          reportText: 'Done',
          status: 'completed',
        })
      ),
      markDispatchSubmitted: vi.fn(),
      mobilePushService: {
        notifyWorkerDone,
      },
      workspaceStore: {
        getWorker: store.getWorker,
        markTaskReported: vi.fn(),
      } as never,
    })

    ops.reportTask(workspace.id, worker.id, {
      dispatchId: 'dispatch-1',
      status: 'success',
      text: 'Done',
    })

    expect(notifyWorkerDone).toHaveBeenCalledWith(workspace.id, 'Alice', 'Done', 'dispatch-1')
  })
})
