import { Pencil, Play, ShieldCheck, Square, Trash2 } from 'lucide-react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'

import type { TeamListItem } from '../../../src/shared/types.js'
import { useI18n } from '../i18n.js'
import { Tooltip } from '../ui/Tooltip.js'
import type { WorkerCardActionKind } from './WorkerCard.js'
import { presentWorkerStatus } from './worker-status.js'

interface SentinelCardProps {
  hasRun: boolean
  isPending?: boolean
  onAction: (kind: WorkerCardActionKind, worker: TeamListItem) => void
  onClick: (worker: TeamListItem) => void
  worker: TeamListItem
}

export const SentinelCard = ({
  hasRun,
  isPending = false,
  onAction,
  onClick,
  worker,
}: SentinelCardProps) => {
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
      data-testid={`sentinel-card-${worker.id}`}
      data-status={status.kind}
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
            background: 'color-mix(in oklab, var(--status-green) 16%, var(--bg-3))',
            color: 'var(--status-green)',
          }}
          aria-hidden
        >
          <ShieldCheck size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-pri">{worker.name}</span>
            <span className="pill pill--green text-[11px]">{t('worker.sentinelTitle')}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-ter">{t('worker.sentinelDesc')}</p>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {!hasRun ? (
          <SentinelActionButton
            ariaLabel={t('worker.startAria', { name: worker.name })}
            disabled={isPending}
            label={t('common.start')}
            onClick={handleAction('start')}
          >
            <Play size={12} aria-hidden />
          </SentinelActionButton>
        ) : (
          <SentinelActionButton
            ariaLabel={t('worker.stopAria', { name: worker.name })}
            disabled={isPending}
            label={t('common.stop')}
            onClick={handleAction('stop')}
          >
            <Square size={12} aria-hidden />
          </SentinelActionButton>
        )}
        <SentinelActionButton
          ariaLabel={t('worker.renameAria', { name: worker.name })}
          disabled={isPending}
          label={t('worker.rename')}
          onClick={handleAction('rename')}
        >
          <Pencil size={12} aria-hidden />
        </SentinelActionButton>
        <SentinelActionButton
          ariaLabel={t('worker.deleteAria', { name: worker.name })}
          label={t('common.delete')}
          onClick={handleAction('delete')}
        >
          <Trash2 size={12} aria-hidden />
        </SentinelActionButton>
      </div>
    </div>
  )
}

const SentinelActionButton = ({
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
