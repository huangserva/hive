import { Play, Settings, Square, Trash2, Workflow } from 'lucide-react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'

import type { TeamListItem } from '../../../src/shared/types.js'
import { useI18n } from '../i18n.js'
import { Tooltip } from '../ui/Tooltip.js'
import type { WorkerCardActionKind } from './WorkerCard.js'
import { presentWorkerStatus } from './worker-status.js'

interface WorkflowCardProps {
  hasRun: boolean
  isPending?: boolean
  onAction: (kind: WorkerCardActionKind, worker: TeamListItem) => void
  onClick: (worker: TeamListItem) => void
  worker: TeamListItem
}

export const WorkflowCard = ({
  hasRun,
  isPending = false,
  onAction,
  onClick,
  worker,
}: WorkflowCardProps) => {
  const { t } = useI18n()
  const status = presentWorkerStatus(worker)
  const handleAction =
    (kind: WorkerCardActionKind): ((event: ReactMouseEvent<HTMLButtonElement>) => void) =>
    (event) => {
      event.stopPropagation()
      onAction(kind, worker)
    }

  return (
    <div
      className="card relative flex w-full items-center gap-3 overflow-hidden p-3 text-left"
      data-testid={`workflow-card-${worker.id}`}
      data-status={status.kind}
      style={{
        background: 'color-mix(in oklab, var(--status-purple) 6%, var(--bg-1))',
        borderColor: 'color-mix(in oklab, var(--status-purple) 32%, var(--border))',
      }}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label={t('worker.open', { name: worker.name })}
        onClick={() => onClick(worker)}
      >
        <span
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md"
          style={{
            background: 'color-mix(in oklab, var(--status-purple) 18%, var(--bg-3))',
            color: 'var(--status-purple)',
          }}
          aria-hidden
        >
          <Workflow size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-pri">{worker.name}</span>
            <span className="pill pill--purple text-[11px]">{t('worker.workflowTitle')}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-ter">{t('worker.workflowDesc')}</p>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {!hasRun ? (
          <WorkflowActionButton
            ariaLabel={t('worker.startAria', { name: worker.name })}
            disabled={isPending}
            label={t('common.start')}
            onClick={handleAction('start')}
          >
            <Play size={12} aria-hidden />
          </WorkflowActionButton>
        ) : (
          <WorkflowActionButton
            ariaLabel={t('worker.stopAria', { name: worker.name })}
            disabled={isPending}
            label={t('common.stop')}
            onClick={handleAction('stop')}
          >
            <Square size={12} aria-hidden />
          </WorkflowActionButton>
        )}
        <WorkflowActionButton
          ariaLabel={t('worker.settingsAria', { name: worker.name })}
          disabled={isPending}
          label={t('worker.settings')}
          onClick={handleAction('settings')}
        >
          <Settings size={12} aria-hidden />
        </WorkflowActionButton>
        <WorkflowActionButton
          ariaLabel={t('worker.deleteAria', { name: worker.name })}
          label={t('common.delete')}
          onClick={handleAction('delete')}
        >
          <Trash2 size={12} aria-hidden />
        </WorkflowActionButton>
      </div>
    </div>
  )
}

const WorkflowActionButton = ({
  ariaLabel,
  children,
  disabled,
  label,
  onClick,
}: {
  ariaLabel: string
  children: ReactNode
  disabled?: boolean
  label: string
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void
}) => (
  <Tooltip label={label}>
    <button
      type="button"
      className="worker-card__action"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  </Tooltip>
)
