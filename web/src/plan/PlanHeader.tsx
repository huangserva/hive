import type { ParsedPlan } from '../api.js'
import { useI18n } from '../i18n.js'

const statusColor = (status?: string) => {
  if (status === 'maintenance' || status === 'active') return 'var(--accent)'
  if (status === 'blocked') return 'var(--status-red)'
  return 'var(--text-tertiary)'
}

export const getPlanProgress = (plan: ParsedPlan) => {
  const total = plan.milestones.reduce((sum, milestone) => sum + milestone.totalCount, 0)
  const done = plan.milestones.reduce((sum, milestone) => sum + milestone.doneCount, 0)
  return {
    done,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    total,
  }
}

export const PlanHeader = ({ plan }: { plan: ParsedPlan }) => {
  const { t } = useI18n()
  const progress = getPlanProgress(plan)
  const title = plan.frontmatter.title ?? t('plan.header.defaultTitle')
  const status = plan.frontmatter.status ?? t('plan.header.unknownStatus')
  return (
    <div className="border-b px-5 py-4" style={{ borderColor: 'var(--border)' }}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-semibold text-lg text-pri">{title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-ter text-xs">
            <span
              className="rounded border px-2 py-0.5"
              style={{
                borderColor: 'color-mix(in oklab, currentColor 35%, transparent)',
                color: statusColor(status),
              }}
            >
              {status}
            </span>
            {plan.frontmatter.current_phase ? <span>{plan.frontmatter.current_phase}</span> : null}
            {plan.frontmatter.last_review ? (
              <span>{t('plan.header.reviewed', { date: plan.frontmatter.last_review })}</span>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 text-right text-xs tabular-nums">
          <div className="font-semibold text-pri">{progress.percent}%</div>
          <div className="text-ter">
            {progress.done}/{progress.total}
          </div>
        </div>
      </div>
      <div
        aria-label={t('plan.header.progress')}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progress.percent}
        className="mt-4 h-1.5 overflow-hidden rounded-full"
        role="progressbar"
        style={{ background: 'var(--bg-3)' }}
      >
        <span
          className="block h-full rounded-full"
          style={{ background: 'var(--accent)', width: `${progress.percent}%` }}
        />
      </div>
    </div>
  )
}
