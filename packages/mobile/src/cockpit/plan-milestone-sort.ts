import type { MobileCockpitMilestone } from '../api/client'

const milestoneIdPattern = /^M(\d+)(?:\.(\d+))?([a-z])?$/i

const parseMilestoneId = (id: string): readonly [number, number, number] | null => {
  const match = milestoneIdPattern.exec(id)
  if (!match) return null
  const major = Number(match[1])
  const minor = match[2] ? Number(match[2]) : 0
  const suffix = match[3] ? match[3].toLowerCase().charCodeAt(0) : Number.MAX_SAFE_INTEGER
  return [major, minor, suffix] as const
}

const parseMilestoneDate = (date?: string): number | null => {
  if (!date) return null
  const timestamp = Date.parse(date)
  return Number.isNaN(timestamp) ? null : timestamp
}

const compareIdDescending = (
  left: readonly [number, number, number] | null,
  right: readonly [number, number, number] | null
) => {
  if (!left || !right) {
    if (left || right) return left ? -1 : 1
    return 0
  }
  return right[0] - left[0] || right[1] - left[1] || right[2] - left[2]
}

const compareMilestones = (left: MobileCockpitMilestone, right: MobileCockpitMilestone) => {
  const leftDate = parseMilestoneDate(left.date)
  const rightDate = parseMilestoneDate(right.date)

  if (leftDate !== null || rightDate !== null) {
    if (leftDate === null || rightDate === null) {
      return leftDate === null ? 1 : -1
    }
    if (leftDate !== rightDate) {
      return rightDate - leftDate
    }
  }

  const leftId = parseMilestoneId(left.id)
  const rightId = parseMilestoneId(right.id)
  return compareIdDescending(leftId, rightId)
}

export const sortPlanMilestonesForDisplay = (milestones: MobileCockpitMilestone[]) =>
  [...milestones].sort(compareMilestones)
