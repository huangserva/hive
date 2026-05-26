// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { TeamListItem } from '../../src/shared/types.js'
import type { TerminalRunSummary } from '../../web/src/api.js'
import { WorkerCard } from '../../web/src/worker/WorkerCard.js'
import { WorkersPane } from '../../web/src/worker/WorkersPane.js'

afterEach(() => {
  cleanup()
})

const worker = (overrides: Partial<TeamListItem> = {}): TeamListItem => ({
  id: 'worker-1',
  name: 'ember-check-23',
  pendingTaskCount: 0,
  role: 'coder',
  status: 'idle',
  ...overrides,
})

const terminalRun = (agentId: string): TerminalRunSummary => ({
  agent_id: agentId,
  agent_name: agentId,
  run_id: `run-${agentId}`,
  status: 'running',
})

describe('worker status presentation', () => {
  test('worker card keeps an idle worker idle even when its PTY is running', () => {
    const onAction = vi.fn()
    render(
      <WorkerCard
        hasRun
        onClick={vi.fn()}
        onAction={onAction}
        worker={worker({ id: 'idle-worker', status: 'idle' })}
      />
    )

    expect(screen.getByRole('status')).toHaveTextContent('idle')
    expect(screen.getByTestId('worker-card-idle-worker')).toHaveAttribute('data-status', 'idle')
    expect(screen.queryByLabelText('Start ember-check-23')).toBeNull()
    screen.getByLabelText('Stop ember-check-23').click()
    expect(onAction).toHaveBeenCalledWith('stop', expect.objectContaining({ id: 'idle-worker' }))
  })

  test('worker card shows start only when no PTY run exists', () => {
    render(
      <WorkerCard
        hasRun={false}
        onClick={vi.fn()}
        onAction={vi.fn()}
        worker={worker({ id: 'stopped-worker', status: 'stopped' })}
      />
    )

    expect(screen.getByLabelText('Start ember-check-23')).toBeInTheDocument()
    expect(screen.queryByLabelText('Stop ember-check-23')).toBeNull()
  })

  test('workers pane groups idle running PTYs separately from active work', () => {
    const idleWorker = worker({ id: 'idle-worker', name: 'idle-agent', status: 'idle' })
    const activeWorker = worker({ id: 'active-worker', name: 'active-agent', status: 'working' })
    const stoppedWorker = worker({
      id: 'stopped-worker',
      name: 'stopped-agent',
      status: 'stopped',
    })

    render(
      <WorkersPane
        onAddWorkerClick={vi.fn()}
        onDeleteWorker={vi.fn()}
        onOpenShellTerminal={vi.fn()}
        onOpenWorker={vi.fn()}
        onUpdateWorker={vi.fn()}
        onStartWorker={vi.fn()}
        onStartAllWorkers={vi.fn()}
        onStopAllWorkers={vi.fn()}
        onStopWorker={vi.fn()}
        startingWorkerId={null}
        terminalRuns={[terminalRun(idleWorker.id), terminalRun(activeWorker.id)]}
        workers={[idleWorker, activeWorker, stoppedWorker]}
      />
    )

    expect(screen.getByRole('list', { name: 'running team members' })).toBeInTheDocument()
    const idleList = screen.getByRole('list', { name: 'idle team members' })
    expect(screen.getByRole('list', { name: 'stopped team members' })).toBeInTheDocument()

    expect(within(idleList).getByText('idle-agent')).toBeInTheDocument()
    expect(within(idleList).queryByText('active-agent')).toBeNull()
  })

  test('workers pane enables bulk start and stop from worker/run state', () => {
    render(
      <WorkersPane
        onAddWorkerClick={vi.fn()}
        onDeleteWorker={vi.fn()}
        onOpenShellTerminal={vi.fn()}
        onOpenWorker={vi.fn()}
        onUpdateWorker={vi.fn()}
        onStartWorker={vi.fn()}
        onStartAllWorkers={vi.fn()}
        onStopAllWorkers={vi.fn()}
        onStopWorker={vi.fn()}
        startingWorkerId={null}
        terminalRuns={[terminalRun('idle-worker')]}
        workers={[
          worker({ id: 'idle-worker', name: 'idle-agent', status: 'idle' }),
          worker({ id: 'stopped-worker', name: 'stopped-agent', status: 'stopped' }),
        ]}
      />
    )

    expect(screen.getByRole('button', { name: 'Start all' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Stop all' })).toBeEnabled()
  })

  test('workers pane renders sentinel in a separate top section', () => {
    const sentinel = worker({
      id: 'sentinel-worker',
      name: 'watchtower',
      role: 'sentinel',
      status: 'idle',
    })
    const regular = worker({ id: 'coder-worker', name: 'coder-agent', status: 'idle' })

    render(
      <WorkersPane
        onAddWorkerClick={vi.fn()}
        onDeleteWorker={vi.fn()}
        onOpenShellTerminal={vi.fn()}
        onOpenWorker={vi.fn()}
        onUpdateWorker={vi.fn()}
        onStartWorker={vi.fn()}
        onStartAllWorkers={vi.fn()}
        onStopAllWorkers={vi.fn()}
        onStopWorker={vi.fn()}
        startingWorkerId={null}
        terminalRuns={[]}
        workers={[regular, sentinel]}
      />
    )

    const sentinelSection = screen.getByTestId('sentinel-section')
    expect(within(sentinelSection).getByText('watchtower')).toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: 'idle team members' })).queryByText('watchtower')
    ).toBeNull()
  })

  test('workers pane disables bulk buttons when no worker can be started or stopped', () => {
    render(
      <WorkersPane
        onAddWorkerClick={vi.fn()}
        onDeleteWorker={vi.fn()}
        onOpenShellTerminal={vi.fn()}
        onOpenWorker={vi.fn()}
        onUpdateWorker={vi.fn()}
        onStartWorker={vi.fn()}
        onStartAllWorkers={vi.fn()}
        onStopAllWorkers={vi.fn()}
        onStopWorker={vi.fn()}
        startingWorkerId={null}
        terminalRuns={[]}
        workers={[worker({ id: 'idle-worker', name: 'idle-agent', status: 'idle' })]}
      />
    )

    expect(screen.getByRole('button', { name: 'Start all' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Stop all' })).toBeDisabled()
  })
})
