import { useCallback, useState } from 'react'

import type { WorkspaceSummary } from '../../src/shared/types.js'
import { AppOverlays } from './AppOverlays.js'
import { AppProviders } from './AppProviders.js'
import { AppWorkspaceContent } from './AppWorkspaceContent.js'
import { DEMO_TASKS_MD } from './demo/demo-fixture.js'
import { useDemoMode } from './demo/useDemoMode.js'
import { useEffectiveWorkspaceState } from './demo/useEffectiveWorkspaceState.js'
import { MainLayout } from './layout/MainLayout.js'
import { Sidebar } from './sidebar/Sidebar.js'
import { useTasksFile } from './tasks/useTasksFile.js'
import { useOptimisticTerminalRuns } from './terminal/useOptimisticTerminalRuns.js'
import { useTerminalRuns } from './terminal/useTerminalRuns.js'
import { useToast } from './ui/useToast.js'
import { useAppShortcuts } from './useAppShortcuts.js'
import { useBeforeUnloadGuard } from './useBeforeUnloadGuard.js'
import { useInitializeUiSession } from './useInitializeUiSession.js'
import { useWorkerHighlight } from './useWorkerHighlight.js'
import { useWorkspaceCreate } from './useWorkspaceCreate.js'
import { useWorkspaceDelete } from './useWorkspaceDelete.js'
import { useWorkspaceSelection } from './useWorkspaceSelection.js'
import { useWorkspaceWorkers } from './useWorkspaceWorkers.js'
import { useFirstRunWizard } from './wizard/useFirstRunWizard.js'
import { useWorkerActions } from './worker/useWorkerActions.js'

// Task Graph/Blueprint was Hive's early first-class `.hive/tasks.md` planning surface.
// Real usage has moved toward letting the Orchestrator agent plan in its own context,
// so the primary UI entry is hidden while the drawer/API stay preserved for compatibility
// and possible revival.
const TASK_GRAPH_PRIMARY_ENTRY_ENABLED = false

const AppInner = () => {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null)
  const { activeWorkspaceId, selectWorkspace, setActiveWorkspaceId } = useWorkspaceSelection()
  const { demoMode, enableDemo, exitDemo } = useDemoMode()
  const localPollIds = demoMode || !workspaces ? [] : workspaces.map(({ id }) => id)
  const [workersByWorkspaceId, setWorkersByWorkspaceId] = useWorkspaceWorkers(localPollIds)
  const [addDialogTrigger, setAddDialogTrigger] = useState(0)
  const [taskGraphOpen, setTaskGraphOpen] = useState(false)
  const toast = useToast()
  const { wizardOpen, closeWizard } = useFirstRunWizard(workspaces)
  const triggerAddDialog = useCallback(() => setAddDialogTrigger((v) => v + 1), [])
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)
  const onBootstrapError = useCallback(
    (message: string) => {
      setBootstrapError(message)
      toast.show({ kind: 'error', message })
    },
    [toast]
  )
  useInitializeUiSession(setWorkspaces, setActiveWorkspaceId, onBootstrapError)
  const wsCreate = useWorkspaceCreate({
    onWorkspaceCreated: (ws) => {
      setWorkspaces((c) => (c === null ? [ws] : [...c, ws]))
      selectWorkspace(ws.id)
      setWorkersByWorkspaceId((c) => ({ ...c, [ws.id]: [] }))
    },
    onError: (message) => toast.show({ kind: 'error', message }),
  })
  const wsState = { demoMode, workspaces, activeWorkspaceId, workersByWorkspaceId }
  const eff = useEffectiveWorkspaceState(wsState)
  const activeId = eff.effectiveActiveWorkspace?.id
  const activeWorkers = activeId ? (eff.effectiveWorkersByWorkspaceId[activeId] ?? []) : []
  const terms = useOptimisticTerminalRuns(eff.pollWorkspaceId, useTerminalRuns(eff.pollWorkspaceId))
  useBeforeUnloadGuard(terms.terminalRuns.some((run) => run.status !== 'stopped'))
  const taskGraphWorkspaceId =
    TASK_GRAPH_PRIMARY_ENTRY_ENABLED && !demoMode ? (activeWorkspaceId ?? null) : null
  const tasksFile = useTasksFile(
    taskGraphWorkspaceId,
    TASK_GRAPH_PRIMARY_ENTRY_ENABLED && demoMode ? DEMO_TASKS_MD : undefined
  )
  const effectiveTaskGraphOpen = TASK_GRAPH_PRIMARY_ENTRY_ENABLED && taskGraphOpen
  const workerActions = useWorkerActions({
    activeWorkspaceId,
    onWorkerDeleted: terms.forgetOptimisticAgent,
    onWorkerRunStarted: terms.recordOptimisticRun,
    setWorkersByWorkspaceId,
  })
  const deleteWorkspace = useWorkspaceDelete({
    activeWorkspaceId,
    onActiveDeleted: () => setTaskGraphOpen(false),
    selectWorkspace,
    setWorkersByWorkspaceId,
    setWorkspaces,
    workspaces,
  })
  useAppShortcuts({
    bootstrapError,
    onSelectWorkspace: selectWorkspace,
    onTriggerAddDialog: triggerAddDialog,
    workspaces: eff.effectiveWorkspaces,
  })
  const handleSelectOwner = useWorkerHighlight()
  return (
    <MainLayout
      hideTopbarActions={!eff.effectiveActiveWorkspace}
      sidebar={
        <Sidebar
          activeWorkspaceId={eff.effectiveActiveWorkspaceId}
          createDisabledReason={bootstrapError ?? undefined}
          onCreateClick={triggerAddDialog}
          onDeleteWorkspace={deleteWorkspace}
          onSelectWorkspace={selectWorkspace}
          workersByWorkspaceId={eff.effectiveWorkersByWorkspaceId}
          workspaces={eff.effectiveWorkspaces}
        />
      }
    >
      <AppWorkspaceContent
        activeId={activeId}
        activeWorkspace={eff.effectiveActiveWorkspace}
        bootstrapError={bootstrapError}
        demoMode={demoMode}
        onDeleteWorkspace={deleteWorkspace}
        onExitDemo={exitDemo}
        onRequestAddWorkspace={triggerAddDialog}
        onTryDemo={enableDemo}
        optimisticRunsByWorkspaceId={terms.optimisticRunsByWorkspaceId}
        orchestratorAutostartErrors={wsCreate.orchestratorAutostartErrors}
        orchestratorAutostartRunIds={wsCreate.orchestratorAutostartRunIds}
        recordOrchestratorResult={wsCreate.recordOrchestratorResult}
        terminalRuns={terms.terminalRuns}
        workerActions={workerActions}
        workers={activeWorkers}
      />
      <AppOverlays
        addDialogTrigger={addDialogTrigger}
        wizardOpen={wizardOpen}
        onAddWorkspace={triggerAddDialog}
        onCloseTaskGraph={() => setTaskGraphOpen(false)}
        onCloseWizard={closeWizard}
        onCreateWorkspace={wsCreate.createNewWorkspace}
        onTryDemo={enableDemo}
        taskGraphOpen={effectiveTaskGraphOpen}
        tasksFile={tasksFile}
        workspacePath={eff.effectiveActiveWorkspace?.path ?? null}
        workers={activeWorkers}
        onSelectOwner={handleSelectOwner}
      />
    </MainLayout>
  )
}

export const App = () => (
  <AppProviders>
    <AppInner />
  </AppProviders>
)
