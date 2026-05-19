// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { WorkspaceSummary } from '../../src/shared/types.js'
import { AppWorkspaceContent } from '../../web/src/AppWorkspaceContent.js'
import type { TerminalRunSummary } from '../../web/src/api.js'
import type { WorkerActions } from '../../web/src/worker/useWorkerActions.js'

const shellRun = vi.hoisted<TerminalRunSummary>(() => ({
  agent_id: 'ws-1:shell',
  agent_name: 'Shell 1',
  run_id: 'run-shell-1',
  status: 'running',
}))

vi.mock('../../web/src/WorkspaceTerminalPanels.js', () => ({
  WorkspaceTerminalPanels: () => <div data-testid="terminal-panels" />,
}))

vi.mock('../../web/src/WorkspaceDetail.js', () => ({
  WorkspaceDetail: ({
    onShellRunStarted,
  }: {
    onShellRunStarted?: (workspaceId: string, run: TerminalRunSummary) => void
  }) => (
    <button
      type="button"
      data-testid="emit-shell-run"
      onClick={() => onShellRunStarted?.('ws-1', shellRun)}
    >
      emit shell
    </button>
  ),
}))

afterEach(() => {
  cleanup()
})

const workspace: WorkspaceSummary = {
  id: 'ws-1',
  name: 'Alpha',
  path: '/tmp/alpha',
}

const workerActions: WorkerActions = {
  createWorker: vi.fn(),
  deleteWorker: vi.fn(),
  startWorker: vi.fn(),
  stopWorkerRun: vi.fn(),
}

describe('AppWorkspaceContent', () => {
  test('passes started workspace shell runs to the optimistic run recorder', () => {
    const onShellRunStarted = vi.fn()

    render(
      <AppWorkspaceContent
        activeId={workspace.id}
        activeWorkspace={workspace}
        bootstrapError={null}
        demoMode={false}
        onDeleteWorkspace={vi.fn()}
        onExitDemo={vi.fn()}
        onRequestAddWorkspace={vi.fn()}
        onShellRunStarted={onShellRunStarted}
        onTryDemo={vi.fn()}
        optimisticRunsByWorkspaceId={{}}
        orchestratorAutostartErrors={{}}
        orchestratorAutostartRunIds={{}}
        recordOrchestratorResult={vi.fn()}
        terminalRuns={[]}
        workerActions={workerActions}
        workers={[]}
      />
    )

    fireEvent.click(screen.getByTestId('emit-shell-run'))

    expect(onShellRunStarted).toHaveBeenCalledWith(workspace.id, shellRun)
  })
})
