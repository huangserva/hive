import type { MobileCockpitMilestone } from '../api/client'
import { sortPlanMilestonesForDisplay } from './plan-milestone-sort'

const ACTIVE_MILESTONE_SUFFIX = /\s*·\s*(in_progress|open|proposed|blocked|shipped)\s*$/i

export const countActiveDispatches = (dispatches: Array<{ status: string }>) =>
  dispatches.filter(
    (dispatch) => dispatch.status === 'pending' || dispatch.status === 'in_progress'
  ).length

export const selectLatestActiveMilestone = (milestones: MobileCockpitMilestone[]) => {
  const sorted = sortPlanMilestonesForDisplay(milestones)
  return (
    sorted.find((milestone) => milestone.status === 'in_progress' || milestone.status === 'open') ??
    null
  )
}

export const formatActiveMilestoneLabel = (milestone: MobileCockpitMilestone) => {
  const title = milestone.title.replace(ACTIVE_MILESTONE_SUFFIX, '').trim()
  return title.startsWith(milestone.id) ? title : `${milestone.id} · ${title}`
}
