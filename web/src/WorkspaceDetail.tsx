import { useEffect, useState } from 'react'

import type { TeamListItem, WorkspaceSummary } from '../../src/shared/types.js'
import {
  closeWorkspaceShell,
  isWorkspaceShellRun,
  type OrchestratorStartResult,
  renameWorker,
  startWorkspaceShell,
  type TerminalRunSummary,
} from './api.js'
import { useI18n } from './i18n.js'
import { WorkspaceNotifications } from './notifications/WorkspaceNotifications.js'
import { TerminalBottomPanel } from './terminal/TerminalBottomPanel.js'
import { useTerminalPanelTabs } from './terminal/useTerminalPanelTabs.js'
import { useToast } from './ui/useToast.js'
import { usePaneSplit } from './usePaneSplit.js'
import { AddWorkerDialog } from './worker/AddWorkerDialog.js'
import { OrchestratorPane } from './worker/OrchestratorPane.js'
import { useOrchestratorPaneState } from './worker/useOrchestratorPaneState.js'
import { useWorkerComposer } from './worker/useWorkerComposer.js'
import { WelcomePane } from './worker/WelcomePane.js'
import { WorkersPane } from './worker/WorkersPane.js'

type WorkspaceDetailProps = {
  onCreateWorker: WorkerActions['createWorker']
  onDeleteWorker: (workerId: string) => Promise<void>
  onDeleteWorkspace: (workspace: WorkspaceSummary) => Promise<void>
  onStartWorker: (workerId: string) => Promise<{ error: string | null; runId: string | null }>
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
  const [composerOpen, setComposerOpen] = useState(false)
  const [deleteWorkerError, setDeleteWorkerError] = useState<string | null>(null)
  const [shellError, setShellError] = useState<string | null>(null)
  const [shellRunId, setShellRunId] = useState<string | null>(null)
  const [shellStarting, setShellStarting] = useState(false)
  const [startWorkerError, setStartWorkerError] = useState<string | null>(null)
  const [startingWorkerId, setStartingWorkerId] = useState<string | null>(null)
  const toast = useToast()
  const composer = useWorkerComposer({ createWorker: onCreateWorker, open: composerOpen })

  // Surface composer / delete errors as toasts instead of inline alert bands.
  useEffect(() => {
    if (composer.createWorkerError)
      toast.show({ kind: 'error', message: composer.createWorkerError })
  }, [composer.createWorkerError, toast])

  useEffect(() => {
    if (deleteWorkerError) toast.show({ kind: 'error', message: deleteWorkerError })
  }, [deleteWorkerError, toast])

  // Start failures no longer have a modal banner to display them — surface
  // via toast to keep parity with delete-error feedback.
  useEffect(() => {
    if (startWorkerError) toast.show({ kind: 'error', message: startWorkerError })
  }, [startWorkerError, toast])

  // Shell-start failures no longer have a dialog banner — surface via toast.
  useEffect(() => {
    if (shellError) toast.show({ kind: 'error', message: shellError })
  }, [shellError, toast])

  // B2: when the user switches workspace, clear local error state so we don't
  // surface a stale error from the previous workspace as a fresh toast.
  // biome-ignore lint/correctness/useExhaustiveDependencies: effect intentionally fires only on workspace switch
  useEffect(() => {
    setDeleteWorkerError(null)
    setShellError(null)
    setShellRunId(null)
    setShellStarting(false)
    setStartWorkerError(null)
    setStartingWorkerId(null)
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
  const panelTabs = useTerminalPanelTabs({
    workspaceId: workspace?.id ?? '',
    workers,
    terminalRuns,
  })

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

  const shellRuns = terminalRuns.filter((run) => isWorkspaceShellRun(run, workspace.id))
  const activeShellRun = shellRuns.find((run) => run.run_id === shellRunId) ?? shellRuns[0] ?? null
  const activeShellRunId = activeShellRun?.run_id ?? null

  const handleDeleteWorker = (worker: TeamListItem) => {
    setDeleteWorkerError(null)
    void onDeleteWorker(worker.id).catch((error) => {
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

  const handleRenameWorker = async (
    worker: TeamListItem,
    newName: string
  ): Promise<{ error: string | null }> => {
    try {
      await renameWorker(workspace.id, worker.id, newName)
      toast.show({
        kind: 'success',
        message: t('worker.renameSuccess', { name: newName }),
      })
      return { error: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.show({ kind: 'error', message: t('worker.renameFailed', { message }) })
      return { error: message }
    }
  }

  const startShell = () => {
    setShellError(null)
    setShellStarting(true)
    void startWorkspaceShell(workspace.id)
      .then((run) => {
        setShellRunId(run.run_id)
        panelTabs.openShellTab(run.run_id)
      })
      .catch((error) => {
        setShellError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => setShellStarting(false))
  }

  const openShell = () => {
    if (shellRuns.length === 0 && !shellStarting) startShell()
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
          className="flex min-w-[480px] shrink-0 flex-col"
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
        <div className="flex min-w-0 flex-1 flex-col">
          <WorkersPane
            onAddWorkerClick={() => setComposerOpen(true)}
            onDeleteWorker={handleDeleteWorker}
            onOpenShellTerminal={openShell}
            onOpenWorker={(worker) => panelTabs.openWorkerTab(worker.id)}
            onRenameWorker={handleRenameWorker}
            onStartWorker={handleStartWorker}
            startingWorkerId={startingWorkerId}
            terminalRuns={terminalRuns}
            workers={workers}
          />
          <TerminalBottomPanel
            tabs={panelTabs.tabs}
            activeId={panelTabs.activeId}
            onSelect={panelTabs.setActive}
            onClose={(tabId) => {
              if (tabId.startsWith('shell:')) {
                const runId = tabId.slice('shell:'.length)
                closeShellTab(runId)
              }
              panelTabs.closeTab(tabId)
            }}
            onNewShell={startShell}
            newShellPending={shellStarting}
            onStartWorker={(workerId) => {
              const worker = workers.find((w) => w.id === workerId)
              if (worker) handleStartWorker(worker)
            }}
            startingWorkerId={startingWorkerId}
          />
        </div>
      </div>
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
          roleDescription={composer.roleDescription}
          roleDescriptionDefault={composer.roleDescriptionDefault}
          startupCommand={composer.startupCommand}
          workerName={composer.workerName}
          workerRole={composer.workerRole}
        />
      ) : null}
    </div>
  )
}
