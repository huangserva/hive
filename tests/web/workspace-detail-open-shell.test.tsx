// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { TeamListItem, WorkspaceSummary } from '../../src/shared/types.js'
import type { TerminalRunSummary } from '../../web/src/api.js'
import { startWorkspaceShell } from '../../web/src/api.js'
import { NotificationProvider } from '../../web/src/notifications/NotificationProvider.js'
import { ToastProvider } from '../../web/src/ui/useToast.js'
import { WorkspaceDetail } from '../../web/src/WorkspaceDetail.js'

vi.mock('../../web/src/api.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../web/src/api.js')>('../../web/src/api.js')
  return {
    ...actual,
    closeWorkspaceShell: vi.fn(() => Promise.resolve()),
    renameWorker: vi.fn(() => Promise.resolve()),
    startWorkspaceShell: vi.fn(),
  }
})

const workspace: WorkspaceSummary = {
  id: 'ws-1',
  name: 'Alpha',
  path: '/tmp/alpha',
}

const workspaceTwo: WorkspaceSummary = {
  id: 'ws-2',
  name: 'Beta',
  path: '/tmp/beta',
}

const worker: TeamListItem = {
  id: 'worker-1',
  name: 'Alice',
  pendingTaskCount: 0,
  role: 'coder',
  status: 'idle',
}

const shellRun = (runId = 'shell-run-1', workspaceId = workspace.id): TerminalRunSummary => ({
  agent_id: `${workspaceId}:shell`,
  agent_name: 'Shell 1',
  run_id: runId,
  status: 'running',
})

const workerRun = (): TerminalRunSummary => ({
  agent_id: worker.id,
  agent_name: worker.name,
  run_id: 'worker-run-1',
  status: 'running',
})

const renderWorkspaceDetail = ({
  onShellRunStarted,
  selectedWorkspace = workspace,
  terminalRuns = [],
}: {
  onShellRunStarted?: (workspaceId: string, run: TerminalRunSummary) => void
  selectedWorkspace?: WorkspaceSummary
  terminalRuns?: TerminalRunSummary[]
} = {}) => renderWorkspaceDetailUi({ onShellRunStarted, selectedWorkspace, terminalRuns })

const renderWorkspaceDetailUi = ({
  onShellRunStarted,
  selectedWorkspace,
  terminalRuns,
}: {
  onShellRunStarted?: (workspaceId: string, run: TerminalRunSummary) => void
  selectedWorkspace: WorkspaceSummary
  terminalRuns: TerminalRunSummary[]
}) =>
  render(
    <ToastProvider>
      <NotificationProvider>
        <WorkspaceDetail
          onCreateWorker={vi.fn()}
          onDeleteWorker={vi.fn()}
          onDeleteWorkspace={vi.fn()}
          onStartWorker={vi.fn()}
          onOrchestratorResult={vi.fn()}
          onRequestAddWorkspace={vi.fn()}
          onShellRunStarted={onShellRunStarted}
          orchestratorAutostartError={null}
          orchestratorAutostartRunId={null}
          terminalRuns={terminalRuns}
          workers={[worker]}
          workspace={selectedWorkspace}
        />
      </NotificationProvider>
    </ToastProvider>
  )

const workspaceDetailUi = ({
  onShellRunStarted,
  selectedWorkspace,
  terminalRuns,
}: {
  onShellRunStarted?: (workspaceId: string, run: TerminalRunSummary) => void
  selectedWorkspace: WorkspaceSummary
  terminalRuns: TerminalRunSummary[]
}) => (
  <ToastProvider>
    <NotificationProvider>
      <WorkspaceDetail
        onCreateWorker={vi.fn()}
        onDeleteWorker={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onStartWorker={vi.fn()}
        onOrchestratorResult={vi.fn()}
        onRequestAddWorkspace={vi.fn()}
        onShellRunStarted={onShellRunStarted}
        orchestratorAutostartError={null}
        orchestratorAutostartRunId={null}
        terminalRuns={terminalRuns}
        workers={[worker]}
        workspace={selectedWorkspace}
      />
    </NotificationProvider>
  </ToastProvider>
)

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  window.localStorage.clear()
  vi.mocked(startWorkspaceShell).mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('WorkspaceDetail shell terminal button', () => {
  test('starts a workspace shell when there is no shell tab or shell run', async () => {
    const run = shellRun()
    const onShellRunStarted = vi.fn()
    vi.mocked(startWorkspaceShell).mockResolvedValue(run)

    const view = renderWorkspaceDetail({ onShellRunStarted })
    fireEvent.click(screen.getByTestId('open-workspace-shell'))

    expect(startWorkspaceShell).toHaveBeenCalledTimes(1)
    expect(startWorkspaceShell).toHaveBeenCalledWith(workspace.id)
    await waitFor(() => {
      expect(onShellRunStarted).toHaveBeenCalledWith(workspace.id, run)
    })

    view.rerender(workspaceDetailUi({ selectedWorkspace: workspace, terminalRuns: [run] }))
    const panel = await screen.findByTestId('terminal-bottom-panel')
    expect(within(panel).getByTestId(`terminal-panel-slot-shell-${run.run_id}`)).toBeInTheDocument()
  })

  test('starts a workspace shell when only a stale shell run exists without a shell tab', async () => {
    const staleRun = shellRun()
    const run = shellRun('shell-run-2')
    vi.mocked(startWorkspaceShell).mockResolvedValue(run)

    const view = renderWorkspaceDetail({ terminalRuns: [staleRun] })
    fireEvent.click(screen.getByTestId('open-workspace-shell'))

    expect(startWorkspaceShell).toHaveBeenCalledTimes(1)
    expect(startWorkspaceShell).toHaveBeenCalledWith(workspace.id)

    view.rerender(
      workspaceDetailUi({ selectedWorkspace: workspace, terminalRuns: [staleRun, run] })
    )
    const panel = await screen.findByTestId('terminal-bottom-panel')
    expect(within(panel).getByTestId(`terminal-panel-slot-shell-${run.run_id}`)).toBeInTheDocument()
  })

  test('focuses an existing shell tab without starting another shell', async () => {
    const shell = shellRun()
    window.localStorage.setItem(
      `hive.terminal-panel.tabs.${workspace.id}`,
      JSON.stringify([`worker:${worker.id}`, `shell:${shell.run_id}`])
    )
    window.localStorage.setItem(`hive.terminal-panel.active.${workspace.id}`, `worker:${worker.id}`)

    renderWorkspaceDetail({ terminalRuns: [workerRun(), shell] })
    const panel = await screen.findByTestId('terminal-bottom-panel')
    expect(within(panel).getByTestId(`terminal-panel-slot-worker-${worker.id}`)).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('open-workspace-shell'))

    await waitFor(() => {
      expect(
        within(panel).getByTestId(`terminal-panel-slot-shell-${shell.run_id}`)
      ).toBeInTheDocument()
    })
    expect(startWorkspaceShell).not.toHaveBeenCalled()
  })

  test('ignores a resolved shell start after switching workspaces', async () => {
    const ws1Start = deferred<TerminalRunSummary>()
    const ws2Run = shellRun('ws-2-shell-run-1', workspaceTwo.id)
    vi.mocked(startWorkspaceShell)
      .mockReturnValueOnce(ws1Start.promise)
      .mockResolvedValueOnce(ws2Run)

    const view = renderWorkspaceDetail()
    fireEvent.click(screen.getByTestId('open-workspace-shell'))
    expect(startWorkspaceShell).toHaveBeenCalledWith(workspace.id)

    view.rerender(workspaceDetailUi({ selectedWorkspace: workspaceTwo, terminalRuns: [] }))
    const lateWs1Run = shellRun('ws-1-late-shell-run', workspace.id)
    await act(async () => {
      ws1Start.resolve(lateWs1Run)
      await ws1Start.promise
    })

    const storedTabs = window.localStorage.getItem(`hive.terminal-panel.tabs.${workspaceTwo.id}`)
    expect(storedTabs ?? '').not.toContain(lateWs1Run.run_id)
    expect(screen.queryByTestId('terminal-bottom-panel')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('open-workspace-shell'))
    expect(startWorkspaceShell).toHaveBeenCalledTimes(2)
    expect(startWorkspaceShell).toHaveBeenLastCalledWith(workspaceTwo.id)

    view.rerender(workspaceDetailUi({ selectedWorkspace: workspaceTwo, terminalRuns: [ws2Run] }))
    const panel = await screen.findByTestId('terminal-bottom-panel')
    expect(
      within(panel).getByTestId(`terminal-panel-slot-shell-${ws2Run.run_id}`)
    ).toBeInTheDocument()
  })

  test('does not start more than one workspace shell while a start is in flight', () => {
    vi.mocked(startWorkspaceShell).mockReturnValue(new Promise(() => {}))

    renderWorkspaceDetail()
    const terminalButton = screen.getByTestId('open-workspace-shell')
    fireEvent.click(terminalButton)
    fireEvent.click(terminalButton)

    expect(startWorkspaceShell).toHaveBeenCalledTimes(1)
  })

  test('keeps a pending shell start locked to its workspace across workspace switches', async () => {
    const ws1Start = deferred<TerminalRunSummary>()
    vi.mocked(startWorkspaceShell).mockReturnValueOnce(ws1Start.promise)

    const view = renderWorkspaceDetail()
    fireEvent.click(screen.getByTestId('open-workspace-shell'))
    expect(startWorkspaceShell).toHaveBeenCalledTimes(1)
    expect(startWorkspaceShell).toHaveBeenLastCalledWith(workspace.id)

    view.rerender(workspaceDetailUi({ selectedWorkspace: workspaceTwo, terminalRuns: [] }))
    view.rerender(workspaceDetailUi({ selectedWorkspace: workspace, terminalRuns: [] }))
    fireEvent.click(screen.getByTestId('open-workspace-shell'))

    expect(startWorkspaceShell).toHaveBeenCalledTimes(1)

    const lateWs1Run = shellRun('ws-1-late-shell-run', workspace.id)
    await act(async () => {
      ws1Start.resolve(lateWs1Run)
      await ws1Start.promise
    })

    fireEvent.click(screen.getByTestId('open-workspace-shell'))
    expect(startWorkspaceShell).toHaveBeenCalledTimes(1)

    view.rerender(workspaceDetailUi({ selectedWorkspace: workspace, terminalRuns: [lateWs1Run] }))
    const panel = await screen.findByTestId('terminal-bottom-panel')
    expect(
      within(panel).getByTestId(`terminal-panel-slot-shell-${lateWs1Run.run_id}`)
    ).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('open-workspace-shell'))

    expect(startWorkspaceShell).toHaveBeenCalledTimes(1)
  })

  test('forgets a remembered shell run when polling never confirms it', async () => {
    vi.useFakeTimers()
    const start = deferred<TerminalRunSummary>()
    const startedRun = shellRun('ws-1-started-but-never-polled', workspace.id)
    vi.mocked(startWorkspaceShell)
      .mockReturnValueOnce(start.promise)
      .mockResolvedValueOnce(shellRun('ws-1-shell-run-2', workspace.id))

    renderWorkspaceDetail()
    fireEvent.click(screen.getByTestId('open-workspace-shell'))
    await act(async () => {
      start.resolve(startedRun)
      await start.promise
    })

    fireEvent.click(screen.getByTestId('open-workspace-shell'))
    expect(startWorkspaceShell).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.runOnlyPendingTimers()
    })
    fireEvent.click(screen.getByTestId('open-workspace-shell'))

    expect(startWorkspaceShell).toHaveBeenCalledTimes(2)
  })
})
