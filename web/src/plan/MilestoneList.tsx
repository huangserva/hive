import type { ParsedMilestone, PlanMilestoneStatus } from '../api.js'
import { MilestoneCard } from './MilestoneCard.js'

const GROUPS: Array<{ label: string; status: PlanMilestoneStatus }> = [
  { label: 'Shipped', status: 'shipped' },
  { label: 'In progress', status: 'in_progress' },
  { label: 'Blocked', status: 'blocked' },
  { label: 'Proposed', status: 'proposed' },
  { label: 'Open', status: 'open' },
]

export const MilestoneList = ({ milestones }: { milestones: ParsedMilestone[] }) => {
  if (!milestones.length) {
    return (
      <section
        className="rounded border p-4 text-sec text-sm"
        style={{ borderColor: 'var(--border)' }}
      >
        No milestones parsed from plan.md.
      </section>
    )
  }
  return (
    <div className="space-y-4">
      {GROUPS.map(({ label, status }) => {
        const group = milestones.filter((milestone) => milestone.status === status)
        if (!group.length) return null
        return (
          <section key={status}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-medium text-pri text-sm">{label}</h3>
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
