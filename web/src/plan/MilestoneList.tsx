import type { ParsedMilestone, PlanMilestoneStatus } from '../api.js'
import { type TranslationKey, useI18n } from '../i18n.js'
import { MilestoneCard } from './MilestoneCard.js'

const GROUPS: Array<{ labelKey: TranslationKey; status: PlanMilestoneStatus }> = [
  { labelKey: 'plan.milestone.shipped', status: 'shipped' },
  { labelKey: 'plan.milestone.inProgress', status: 'in_progress' },
  { labelKey: 'plan.milestone.blocked', status: 'blocked' },
  { labelKey: 'plan.milestone.proposed', status: 'proposed' },
  { labelKey: 'plan.milestone.open', status: 'open' },
]

export const MilestoneList = ({ milestones }: { milestones: ParsedMilestone[] }) => {
  const { t } = useI18n()
  if (!milestones.length) {
    return (
      <section
        className="rounded border p-4 text-sec text-sm"
        style={{ borderColor: 'var(--border)' }}
      >
        {t('plan.milestone.empty')}
      </section>
    )
  }
  return (
    <div className="space-y-4">
      {GROUPS.map(({ labelKey, status }) => {
        const group = milestones.filter((milestone) => milestone.status === status)
        if (!group.length) return null
        return (
          <section key={status}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-medium text-pri text-sm">{t(labelKey)}</h3>
              <span className="text-ter text-xs tabular-nums">{group.length}</span>
            </div>
            <div className="space-y-2">
              {group.map((milestone) => (
                <MilestoneCard key={milestone.id} milestone={milestone} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
