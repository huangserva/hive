import { useEffect, useState } from 'react'

import type { TeamListItem, WorkspaceSummary } from '../../src/shared/types.js'
import {
  closeWorkspaceShell,
  isWorkspaceShellRun,
  type OrchestratorStartResult,
  startWorkspaceShell,
  type TerminalRunSummary,
  updateWorker,
} from './api.js'
import { useI18n } from './i18n.js'
import { WorkspaceNotifications } from './notifications/WorkspaceNotifications.js'
import { findRunByAgentId } from './terminal/useTerminalRuns.js'
import { WorkspaceShellDialog } from './terminal/WorkspaceShellDialog.js'
import { useToast } from './ui/useToast.js'
import { usePaneSplit } from './usePaneSplit.js'
import { AddWorkerDialog } from './worker/AddWorkerDialog.js'
import { OrchestratorPane } from './worker/OrchestratorPane.js'
import { useOrchestratorPaneState } from './worker/useOrchestratorPaneState.js'
import { useWorkerComposer } from './worker/useWorkerComposer.js'
import { WelcomePane } from './worker/WelcomePane.js'
import { WorkerModal } from './worker/WorkerModal.js'
import { WorkersPane } from './worker/WorkersPane.js'

type WorkspaceDetailProps = {
  onCreateWorker: WorkerActions['createWorker']
  onDeleteWorker: (workerId: string) => Promise<void>
  onDeleteWorkspace: (workspace: WorkspaceSummary) => Promise<void>
  onStartWorker: (workerId: string) => Promise<{ error: string | null; runId: string | null }>
  onStopWorkerRun: (runId: string) => Promise<{ error: string | null }>
  onOrchestratorResult: (workspaceId: string, result: OrchestratorStartResult) => void
  onRequestAddWorkspace: () => void
  onTryDemo?: () => void
  welcomeDisabledReason?: string
  orchestratorAutostartError: string | null
  orchestratorAutostartRunId: string | null
  terminalRuns: TerminalRunSummary[]
  workers: TeamListItem[]
  workspace: WorkspaceSummary | undefined
}

export const WorkspaceDetail = ({
  onCreateWorker,
  onDeleteWorker,
  onDeleteWorkspace,
  onStartWorker,
  onStopWorkerRun,
  onOrchestratorResult,
  onRequestAddWorkspace,
  onTryDemo,
  welcomeDisabledReason,
  orchestratorAutostartError,
  orchestratorAutostartRunId,
  terminalRuns,
  workers,
  workspace,
}: WorkspaceDetailProps) => {
  const { t } = useI18n()
  const [activeWorkerId, setActiveWorkerId] = useState<string | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [deleteWorkerError, setDeleteWorkerError] = useState<string | null>(null)
  const [shellError, setShellError] = useState<string | null>(null)
  const [shellOpen, setShellOpen] = useState(false)
  const [shellRunId, setShellRunId] = useState<string | null>(null)
  const [shellStarting, setShellStarting] = useState(false)
  const [startWorkerError, setStartWorkerError] = useState<string | null>(null)
  const [startingWorkerId, setStartingWorkerId] = useState<string | null>(null)
  const [stoppingWorkerId, setStoppingWorkerId] = useState<string | null>(null)
  const toast = useToast()
  // Always derive the modal's worker from the latest workers prop so the
  // 500ms poll keeps it fresh — we never freeze a stale snapshot.
  const activeWorker: TeamListItem | null =
    workers.find((worker) => worker.id === activeWorkerId) ?? null
  // If the worker disappears (delete / workspace switch), close the modal.
  useEffect(() => {
    if (activeWorkerId && !activeWorker) setActiveWorkerId(null)
  }, [activeWorkerId, activeWorker])
  const composer = useWorkerComposer({ createWorker: onCreateWorker, open: composerOpen })

  // Surface composer / delete errors as toasts instead of inline alert bands.
  useEffect(() => {
    if (composer.createWorkerError)
      toast.show({ kind: 'error', message: composer.createWorkerError })
  }, [composer.createWorkerError, toast])

  useEffect(() => {
    if (deleteWorkerError) toast.show({ kind: 'error', message: deleteWorkerError })
  }, [deleteWorkerError, toast])

  // B2: when the user switches workspace, clear local error state so we don't
  // surface a stale error from the previous workspace as a fresh toast.
  // biome-ignore lint/correctness/useExhaustiveDependencies: effect intentionally fires only on workspace switch
  useEffect(() => {
    setDeleteWorkerError(null)
    setShellError(null)
    setShellOpen(false)
    setShellRunId(null)
    setShellStarting(false)
    setStartWorkerError(null)
    setStartingWorkerId(null)
    setStoppingWorkerId(null)
  }, [workspace?.id])
  const orchestrator = useOrchestratorPaneState({
    workspaceId: workspace?.id ?? '',
    terminalRuns,
    autostartError: orchestratorAutostartError,
    suppressAutostartRunId: orchestratorAutostartRunId,
    onClearAutostartError: () => {
      if (workspace) onOrchestratorResult(workspace.id, { ok: true, error: null, run_id: null })
    },
    onAfterStart: (result) => {
      if (workspace) onOrchestratorResult(workspace.id, result)
    },
  })
  const split = usePaneSplit()

  if (!workspace) {
    const welcomeProps: {
      onAddWorkspace: () => void
      onTryDemo?: () => void
      disabledReason?: string
    } = { onAddWorkspace: onRequestAddWorkspace }
    if (onTryDemo) welcomeProps.onTryDemo = onTryDemo
    if (welcomeDisabledReason) welcomeProps.disabledReason = welcomeDisabledReason
    return <WelcomePane {...welcomeProps} />
  }

  const activeWorkerRun = activeWorker ? findRunByAgentId(terminalRuns, activeWorker.id) : undefined
  const shellRuns = terminalRuns.filter((run) => isWorkspaceShellRun(run, workspace.id))
  const activeShellRun = shellRuns.find((run) => run.run_id === shellRunId) ?? shellRuns[0] ?? null
  const activeShellRunId = activeShellRun?.run_id ?? null

  const handleDeleteWorker = (worker: TeamListItem) => {
    setDeleteWorkerError(null)
    void onDeleteWorker(worker.id)
      .then(() => setActiveWorkerId(null))
      .catch((error) => {
        setDeleteWorkerError(error instanceof Error ? error.message : String(error))
      })
  }

  const handleStartWorker = (worker: TeamListItem) => {
    setStartWorkerError(null)
    setStartingWorkerId(worker.id)
    void onStartWorker(worker.id)
      .then(({ error }) => {
        if (error) setStartWorkerError(error)
      })
      .catch((error) => {
        setStartWorkerError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => setStartingWorkerId(null))
  }

  const handleStopWorker = (worker: TeamListItem) => {
    const runId = findRunByAgentId(terminalRuns, worker.id)?.run_id
    if (!runId) return
    setStartWorkerError(null)
    setStoppingWorkerId(worker.id)
    void onStopWorkerRun(runId)
      .then(({ error }) => {
        if (error) setStartWorkerError(error)
      })
      .catch((error) => {
        setStartWorkerError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => setStoppingWorkerId(null))
  }

  const handleStartAllWorkers = async () => {
    setStartWorkerError(null)
    const stoppedWorkers = workers.filter((worker) => worker.status === 'stopped')
    try {
      for (const worker of stoppedWorkers) {
        const { error } = await onStartWorker(worker.id)
        if (error) {
          setStartWorkerError(error)
          return
        }
      }
    } catch (error) {
      setStartWorkerError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleStopAllWorkers = async () => {
    setStartWorkerError(null)
    const runIds = workers
      .map((worker) => findRunByAgentId(terminalRuns, worker.id)?.run_id ?? null)
      .filter((runId): runId is string => runId !== null)
    try {
      for (const runId of runIds) {
        const { error } = await onStopWorkerRun(runId)
        if (error) {
          setStartWorkerError(error)
          return
        }
      }
    } catch (error) {
      setStartWorkerError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleUpdateWorker = async (
    worker: TeamListItem,
    patch: Record<string, unknown>
  ): Promise<{ error: string | null }> => {
    try {
      await updateWorker(workspace.id, worker.id, patch as Parameters<typeof updateWorker>[2])
      if (patch.name && typeof patch.name === 'string') {
        toast.show({
          kind: 'success',
          message: t('worker.renameSuccess', { name: patch.name }),
        })
      }
      return { error: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.show({ kind: 'error', message })
      return { error: message }
    }
  }

  const startShell = () => {
    setShellError(null)
    setShellStarting(true)
    void startWorkspaceShell(workspace.id)
      .then((run) => setShellRunId(run.run_id))
      .catch((error) => {
        setShellError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => setShellStarting(false))
  }

  const openShell = () => {
    setShellOpen(true)
    if (shellRuns.length === 0 && !shellStarting) startShell()
    else if (!activeShellRunId) setShellRunId(shellRuns[0]?.run_id ?? null)
  }

  const closeShellTab = (runId: string) => {
    const fallbackRun = shellRuns.find((run) => run.run_id !== runId) ?? null
    if (activeShellRunId === runId) setShellRunId(fallbackRun?.run_id ?? null)
    void closeWorkspaceShell(workspace.id, runId).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      toast.show({ kind: 'error', message: t('shellTerminal.closeFailed', { message }) })
    })
  }

  const orchWidth = `${(split.orchPct * 100).toFixed(2)}%`

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" style={{ background: 'var(--bg-2)' }}>
      <WorkspaceNotifications terminalRuns={terminalRuns} workers={workers} workspace={workspace} />
      <div ref={split.containerRef} className="relative flex min-h-0 flex-1">
        <div
          className="flex min-h-0 min-w-[480px] shrink-0 flex-col overflow-hidden"
          style={{ width: orchWidth }}
          data-testid="orchestrator-pane-shell"
        >
          <OrchestratorPane
            state={orchestrator.state}
            onStop={orchestrator.stop}
            onRemoveWorkspace={() => {
              if (!workspace) return
              void onDeleteWorkspace(workspace).catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error)
                toast.show({ kind: 'error', message: `Delete failed: ${message}` })
              })
            }}
            onStart={orchestrator.start}
            onRestart={orchestrator.restart}
          />
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: <hr> can't host pointer/keyboard handlers and the visible accent line; aria role="separator" is the canonical resize-handle role */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('workerPane.resize')}
          aria-valuenow={Math.round(split.orchPct * 100)}
          aria-valuemin={30}
          aria-valuemax={78}
          tabIndex={0}
          className="pane-splitter"
          style={{ left: `calc(${orchWidth} - 4px)` }}
          data-dragging={split.dragging || undefined}
          data-testid="pane-splitter"
          onPointerDown={split.beginDrag}
          onKeyDown={split.onKeyDown}
        />
        <WorkersPane
          onAddWorkerClick={() => setComposerOpen(true)}
          onDeleteWorker={handleDeleteWorker}
          onOpenShellTerminal={openShell}
          onOpenWorker={(worker) => setActiveWorkerId(worker.id)}
          onUpdateWorker={handleUpdateWorker}
          onStartAllWorkers={handleStartAllWorkers}
          onStartWorker={handleStartWorker}
          onStopAllWorkers={handleStopAllWorkers}
          onStopWorker={handleStopWorker}
          startingWorkerId={startingWorkerId ?? stoppingWorkerId}
          terminalRuns={terminalRuns}
          workers={workers}
        />
      </div>
      {activeWorker ? (
        <WorkerModal
          onClose={() => setActiveWorkerId(null)}
          onStart={handleStartWorker}
          runId={activeWorkerRun?.run_id ?? null}
          startError={startWorkerError}
          starting={startingWorkerId === activeWorker.id}
          worker={activeWorker}
        />
      ) : null}

      {composerOpen ? (
        <AddWorkerDialog
          commandPresets={composer.commandPresets}
          commandPresetId={composer.commandPresetId}
          creating={composer.creating}
          onClose={() => setComposerOpen(false)}
          onNameChange={composer.setWorkerName}
          onPresetChange={composer.setCommandPresetId}
          onRandomName={composer.randomizeWorkerName}
          onRoleDescriptionChange={composer.setRoleDescription}
          onRoleDescriptionReset={composer.resetRoleDescription}
          onRoleChange={composer.setWorkerRole}
          onSubmit={(event) => composer.submit(event, () => setComposerOpen(false))}
          onStartupCommandChange={composer.setStartupCommand}
          onTemplateSelect={composer.applyRoleTemplate}
          onThinkingLevelChange={composer.setThinkingLevel}
          roleDescription={composer.roleDescription}
          roleDescriptionDefault={composer.roleDescriptionDefault}
          roleTemplates={composer.roleTemplates}
          startupCommand={composer.startupCommand}
          thinkingLevel={composer.thinkingLevel}
          workerName={composer.workerName}
          workerRole={composer.workerRole}
        />
      ) : null}
      <WorkspaceShellDialog
        activeRunId={activeShellRunId}
        error={shellError}
        onActiveRunChange={setShellRunId}
        onClose={() => setShellOpen(false)}
        onCloseTab={closeShellTab}
        onNewTab={startShell}
        open={shellOpen}
        shellRuns={shellRuns}
        starting={shellStarting}
        workspace={workspace}
      />
    </div>
  )
}
