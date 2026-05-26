import { PlayCircle, StopCircle, Terminal, UserPlus } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { TeamListItem } from '../../../src/shared/types.js'
import type { TerminalRunSummary } from '../api.js'
import { useI18n } from '../i18n.js'
import { findRunByAgentId } from '../terminal/useTerminalRuns.js'
import { Confirm } from '../ui/Confirm.js'
import { EmptyState } from '../ui/EmptyState.js'
import { SentinelCard } from './SentinelCard.js'
import { WorkerCard, type WorkerCardActionKind } from './WorkerCard.js'
import { WorkerSettingsDialog } from './WorkerSettingsDialog.js'
import { presentWorkerStatus, type WorkerStatusKind } from './worker-status.js'

type WorkersPaneProps = {
  onAddWorkerClick: () => void
  onDeleteWorker: (worker: TeamListItem) => void
  onOpenShellTerminal: () => void
  onOpenWorker: (worker: TeamListItem) => void
  onStartAllWorkers: () => Promise<void>
  onStartWorker: (worker: TeamListItem) => void
  onStopAllWorkers: () => Promise<void>
  onStopWorker: (worker: TeamListItem) => void
  onUpdateWorker: (
    worker: TeamListItem,
    patch: Record<string, unknown>
  ) => Promise<{ error: string | null }>
  shellTerminalAvailable?: boolean
  startingWorkerId: string | null
  terminalRuns: TerminalRunSummary[]
  workers: TeamListItem[]
}

const SECTION_ORDER: WorkerStatusKind[] = ['working', 'idle', 'stopped']
const statusKey = (status: WorkerStatusKind) => {
  if (status === 'working') return 'common.running'
  if (status === 'idle') return 'common.idle'
  return 'common.stopped'
}

const groupByWorkerStatus = (workers: TeamListItem[]) => {
  const buckets: Record<WorkerStatusKind, TeamListItem[]> = {
    idle: [],
    working: [],
    stopped: [],
  }
  for (const worker of workers) {
    buckets[presentWorkerStatus(worker).kind].push(worker)
  }
  return SECTION_ORDER.filter((kind) => buckets[kind].length > 0).map((kind) => ({
    kind,
    workers: buckets[kind],
  }))
}

export const WorkersPane = ({
  onAddWorkerClick,
  onDeleteWorker,
  onOpenShellTerminal,
  onOpenWorker,
  onStartAllWorkers,
  onStartWorker,
  onStopAllWorkers,
  onStopWorker,
  onUpdateWorker,
  shellTerminalAvailable = true,
  startingWorkerId,
  terminalRuns,
  workers,
}: WorkersPaneProps) => {
  const { t } = useI18n()
  const sentinelWorker = workers.find((worker) => worker.role === 'sentinel') ?? null
  const regularWorkers = useMemo(
    () => workers.filter((worker) => worker.role !== 'sentinel'),
    [workers]
  )
  const sections = useMemo(() => groupByWorkerStatus(regularWorkers), [regularWorkers])
  const summary = useMemo(() => {
    const buckets = { idle: 0, working: 0, stopped: 0 }
    for (const worker of regularWorkers) buckets[presentWorkerStatus(worker).kind]++
    return buckets
  }, [regularWorkers])
  const [pendingDelete, setPendingDelete] = useState<TeamListItem | null>(null)
  const [settingsTarget, setSettingsTarget] = useState<TeamListItem | null>(null)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [bulkAction, setBulkAction] = useState<'start' | 'stop' | null>(null)

  const runIdFor = (worker: TeamListItem): string | null =>
    findRunByAgentId(terminalRuns, worker.id)?.run_id ?? null
  const hasStoppedWorker = workers.some((worker) => worker.status === 'stopped')
  const hasActiveRun = workers.some((worker) => runIdFor(worker) !== null)
  const bulkBusy = bulkAction !== null

  const handleAction = (kind: WorkerCardActionKind, worker: TeamListItem) => {
    if (kind === 'start') {
      onStartWorker(worker)
      return
    }
    if (kind === 'stop') {
      onStopWorker(worker)
      return
    }
    if (kind === 'settings') {
      setSettingsTarget(worker)
      return
    }
    if (kind === 'delete') {
      setPendingDelete(worker)
    }
  }

  const confirmDelete = () => {
    if (!pendingDelete) return
    onDeleteWorker(pendingDelete)
    setPendingDelete(null)
  }

  const submitSettings = (workerId: string, patch: Record<string, unknown>) => {
    const worker = workers.find((w) => w.id === workerId)
    if (!worker) return
    setSettingsBusy(true)
    void onUpdateWorker(worker, patch).finally(() => {
      setSettingsBusy(false)
      setSettingsTarget(null)
    })
  }

  const runBulkAction = (kind: 'start' | 'stop', action: () => Promise<void>) => {
    setBulkAction(kind)
    void action().finally(() => setBulkAction(null))
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col" style={{ background: 'var(--bg-2)' }}>
      <div
        className="flex shrink-0 flex-col gap-1 px-4 pt-3 pb-2.5"
        style={{
          boxShadow: 'inset 0 -1px 0 var(--border)',
        }}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-pri">{t('worker.teamMembers')}</span>
          <span className="mono rounded bg-3 px-1.5 py-0.5 text-xs text-sec">
            {regularWorkers.length}
          </span>
          <div className="flex-1" />
          {shellTerminalAvailable ? (
            <button
              type="button"
              onClick={onOpenShellTerminal}
              className="icon-btn icon-btn--tertiary"
              aria-label={t('shellTerminal.openAria')}
              data-testid="open-workspace-shell"
            >
              <Terminal size={14} aria-hidden /> {t('shellTerminal.open')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onAddWorkerClick}
            className="icon-btn icon-btn--primary"
            data-testid="add-worker-trigger"
          >
            <UserPlus size={14} aria-hidden /> {t('addWorker.create')}
          </button>
        </div>
        {regularWorkers.length > 0 ? (
          <div className="flex items-center gap-3 text-xs text-ter">
            <span className="inline-flex items-center gap-1.5">
              <span className="status-dot status-dot--working" aria-hidden />
              <span className="text-sec">{summary.working}</span> {t('common.running')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="status-dot status-dot--idle" aria-hidden />
              <span className="text-sec">{summary.idle}</span> {t('common.idle')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="status-dot status-dot--stopped" aria-hidden />
              <span className="text-sec">{summary.stopped}</span> {t('common.stopped')}
            </span>
            <div className="flex-1" />
            <span className="inline-flex items-center gap-1" title={t('worker.startAll')}>
              <button
                type="button"
                onClick={() => runBulkAction('start', onStartAllWorkers)}
                className="icon-btn icon-btn--tertiary"
                aria-label={t('worker.startAll')}
                disabled={!hasStoppedWorker || bulkBusy}
                data-testid="start-all-workers"
              >
                <PlayCircle size={14} aria-hidden />
              </button>
            </span>
            <span className="inline-flex items-center gap-1" title={t('worker.stopAll')}>
              <button
                type="button"
                onClick={() => runBulkAction('stop', onStopAllWorkers)}
                className="icon-btn icon-btn--tertiary"
                aria-label={t('worker.stopAll')}
                disabled={!hasActiveRun || bulkBusy}
                data-testid="stop-all-workers"
              >
                <StopCircle size={14} aria-hidden />
              </button>
            </span>
          </div>
        ) : null}
      </div>

      <div className="workers-pane-body scroll-y flex-1 px-2 py-2">
        {workers.length === 0 ? (
          <EmptyState
            icon={<UserPlus size={28} />}
            title={t('worker.emptyTitle')}
            description={t('worker.emptyDesc')}
            action={
              <button
                type="button"
                onClick={onAddWorkerClick}
                className="icon-btn icon-btn--primary"
                data-testid="add-worker-empty"
              >
                <UserPlus size={14} aria-hidden /> {t('worker.emptyAdd')}
              </button>
            }
          />
        ) : (
          <div data-testid="worker-grid">
            {sentinelWorker ? (
              <section className="mb-3" data-testid="sentinel-section">
                <div className="px-2 py-1 text-xs font-medium uppercase tracking-wider text-ter">
                  {t('worker.sentinelTitle')}
                  <span className="mono ml-1.5 text-ter">1</span>
                </div>
                <SentinelCard
                  hasRun={!!runIdFor(sentinelWorker)}
                  isPending={startingWorkerId === sentinelWorker.id}
                  onAction={handleAction}
                  onClick={onOpenWorker}
                  worker={sentinelWorker}
                />
              </section>
            ) : null}
            {sections.map((section) => (
              <section key={section.kind} className="mb-3 last:mb-0">
                <div className="px-2 py-1 text-xs font-medium uppercase tracking-wider text-ter">
                  {t(statusKey(section.kind))}
                  <span className="mono ml-1.5 text-ter">{section.workers.length}</span>
                </div>
                <ul
                  aria-label={`${t(statusKey(section.kind))} team members`}
                  className="worker-card-grid"
                >
                  {section.workers.map((worker) => (
                    <li key={worker.id}>
                      <WorkerCard
                        hasRun={!!runIdFor(worker)}
                        isPending={startingWorkerId === worker.id}
                        onAction={handleAction}
                        onClick={onOpenWorker}
                        worker={worker}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <Confirm
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={pendingDelete ? t('worker.deleteConfirm', { name: pendingDelete.name }) : ''}
        description={
          pendingDelete ? t('worker.deleteDescription', { name: pendingDelete.name }) : ''
        }
        confirmLabel={t('worker.deleteMember')}
        confirmKind="danger"
        onConfirm={confirmDelete}
      />
      <WorkerSettingsDialog
        worker={settingsTarget}
        busy={settingsBusy}
        onClose={() => setSettingsTarget(null)}
        onSubmit={submitSettings}
      />
    </div>
  )
}
