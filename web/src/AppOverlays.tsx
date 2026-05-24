import { ListChecks } from 'lucide-react'

import type { TeamListItem } from '../../src/shared/types.js'
import { CockpitDrawer } from './cockpit/CockpitDrawer.js'
import type { useCockpit } from './cockpit/useCockpit.js'
import type { useTasksFile } from './tasks/useTasksFile.js'
import { WorkspaceTaskDrawer } from './tasks/WorkspaceTaskDrawer.js'
import { FirstRunWizard } from './wizard/FirstRunWizard.js'
import { AddWorkspaceDialog } from './workspace/AddWorkspaceDialog.js'
import type { WorkspaceCreateInput } from './workspace/workspace-create-input.js'

type TasksFileApi = ReturnType<typeof useTasksFile>
type CockpitApi = ReturnType<typeof useCockpit>

type AppOverlaysProps = {
  addDialogTrigger: number
  cockpitFile: CockpitApi
  cockpitOpen: boolean
  onAddWorkspace: () => void
  onCloseCockpit: () => void
  onCloseTaskGraph: () => void
  onCloseWizard: (shouldMarkSeen?: boolean) => void
  onCreateWorkspace: (input: WorkspaceCreateInput) => Promise<unknown> | undefined
  onOpenTaskGraph: () => void
  onTryDemo: () => void
  openTaskCount: number
  taskGraphOpen: boolean
  tasksFile: TasksFileApi
  wizardOpen: boolean
  workspaceId: string | null
  workspacePath: string | null
  /** Workspace's active worker roster — feeds the §6.6.2 chip resolution. */
  workers?: readonly TeamListItem[]
  /** Cross-pane jump on chip click (§6.6.6). */
  onSelectOwner?: (workerName: string) => void
  /** §3.5.2 transport disconnect flag passed through unchanged. */
  connectionStale?: boolean
}

export const AppOverlays = ({
  addDialogTrigger,
  cockpitFile,
  cockpitOpen,
  onAddWorkspace,
  onCloseCockpit,
  onCloseTaskGraph,
  onCloseWizard,
  onCreateWorkspace,
  onOpenTaskGraph,
  onTryDemo,
  openTaskCount,
  taskGraphOpen,
  tasksFile,
  wizardOpen,
  workspaceId,
  workspacePath,
  workers,
  onSelectOwner,
  connectionStale,
}: AppOverlaysProps) => (
  <>
    {workspaceId && workspacePath ? (
      <CockpitDrawer
        cockpit={cockpitFile.cockpit}
        error={cockpitFile.error}
        isConnected={cockpitFile.isConnected}
        onClose={onCloseCockpit}
        open={cockpitOpen}
        workspaceId={workspaceId}
        workspacePath={workspacePath}
      />
    ) : null}
    {workspacePath ? (
      <WorkspaceTaskDrawer
        open={taskGraphOpen}
        tasksFile={tasksFile}
        onClose={onCloseTaskGraph}
        workspacePath={workspacePath}
        {...(workers ? { workers } : {})}
        {...(onSelectOwner ? { onSelectOwner } : {})}
        {...(connectionStale !== undefined ? { connectionStale } : {})}
      />
    ) : null}
    {workspacePath && !taskGraphOpen ? (
      <button
        aria-label="Toggle Todo"
        className="fixed right-4 bottom-4 z-30 flex h-10 min-w-10 cursor-pointer items-center justify-center gap-2 rounded-full border px-3 text-sec text-xs shadow-lg hover:bg-3 hover:text-pri"
        onClick={onOpenTaskGraph}
        style={{ background: 'var(--bg-1)', borderColor: 'var(--border)' }}
        type="button"
      >
        <ListChecks size={15} className={openTaskCount > 0 ? 'text-accent' : undefined} />
        {openTaskCount > 0 ? <span className="tabular-nums">{openTaskCount}</span> : null}
      </button>
    ) : null}
    <AddWorkspaceDialog
      onClose={() => {}}
      onCreate={onCreateWorkspace}
      trigger={addDialogTrigger}
    />
    <FirstRunWizard
      open={wizardOpen}
      onClose={onCloseWizard}
      onAddWorkspace={onAddWorkspace}
      onTryDemo={onTryDemo}
    />
  </>
)
