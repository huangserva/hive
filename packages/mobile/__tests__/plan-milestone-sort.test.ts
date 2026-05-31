import { describe, expect, test } from 'vitest'

import type { MobileCockpitMilestone } from '../src/api/client'
import { sortPlanMilestonesForDisplay } from '../src/cockpit/plan-milestone-sort'

const milestone = (
  overrides: Partial<MobileCockpitMilestone> &
    Pick<MobileCockpitMilestone, 'id' | 'title' | 'status'>
): MobileCockpitMilestone => ({
  body: '',
  doneCount: 0,
  items: [],
  progress: 0,
  totalCount: 0,
  ...overrides,
})

describe('sortPlanMilestonesForDisplay', () => {
  test('orders milestones by date descending', () => {
    const ordered = sortPlanMilestonesForDisplay([
      milestone({ date: '2026-05-29', id: 'M27', status: 'open', title: 'Older' }),
      milestone({ date: '2026-05-31', id: 'M28', status: 'in_progress', title: 'Newer' }),
      milestone({ date: '2026-05-30', id: 'M26', status: 'blocked', title: 'Middle' }),
    ])

    expect(ordered.map((item) => item.id)).toEqual(['M28', 'M26', 'M27'])
  })

  test('breaks ties on the same date by milestone number descending', () => {
    const ordered = sortPlanMilestonesForDisplay([
      milestone({ date: '2026-05-31', id: 'M27', status: 'open', title: 'M27' }),
      milestone({ date: '2026-05-31', id: 'M28', status: 'in_progress', title: 'M28' }),
      milestone({ date: '2026-05-31', id: 'M6.4', status: 'blocked', title: 'M6.4' }),
      milestone({ date: '2026-05-31', id: 'M6.1', status: 'blocked', title: 'M6.1' }),
    ])

    expect(ordered.map((item) => item.id)).toEqual(['M28', 'M27', 'M6.4', 'M6.1'])
  })

  test('keeps milestones without a date at the end', () => {
    const ordered = sortPlanMilestonesForDisplay([
      milestone({ date: '2026-05-31', id: 'M27', status: 'open', title: 'Dated' }),
      milestone({ id: 'M28', status: 'in_progress', title: 'Undated but new' }),
      milestone({ id: 'M6.4', status: 'blocked', title: 'Undated older' }),
    ])

    expect(ordered.map((item) => item.id)).toEqual(['M27', 'M28', 'M6.4'])
  })

  test('puts M28 at the top even when plan order is out of date', () => {
    const ordered = sortPlanMilestonesForDisplay([
      milestone({ date: '2026-05-20', id: 'M1', status: 'shipped', title: 'Old shipped' }),
      milestone({ date: '2026-05-31', id: 'M28', status: 'in_progress', title: 'Current' }),
      milestone({ date: '2026-05-25', id: 'M20', status: 'open', title: 'Middle' }),
    ])

    expect(ordered[0]?.id).toBe('M28')
    expect(ordered.map((item) => item.id)).toEqual(['M28', 'M20', 'M1'])
  })
})
