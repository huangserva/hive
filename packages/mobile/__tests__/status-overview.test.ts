import { describe, expect, test } from 'vitest'

import type { MobileCockpitMilestone } from '../src/api/client'
import { countActiveDispatches, selectLatestActiveMilestone } from '../src/cockpit/status-overview'

const milestone = (
  overrides: Pick<MobileCockpitMilestone, 'id' | 'title' | 'status'> &
    Partial<MobileCockpitMilestone>
): MobileCockpitMilestone => ({
  body: '',
  doneCount: 0,
  items: [],
  progress: 0,
  totalCount: 0,
  ...overrides,
})

describe('countActiveDispatches', () => {
  test('counts pending and in-progress dispatches but ignores done and cancelled', () => {
    expect(
      countActiveDispatches([
        { status: 'pending' },
        { status: 'in_progress' },
        { status: 'done' },
        { status: 'cancelled' },
      ])
    ).toBe(2)
  })
})

describe('selectLatestActiveMilestone', () => {
  test('returns the newest active milestone instead of the first one in document order', () => {
    const selected = selectLatestActiveMilestone([
      milestone({ date: '2026-05-20', id: 'M24', status: 'in_progress', title: 'Old active' }),
      milestone({ date: '2026-05-31', id: 'M28', status: 'in_progress', title: 'New active' }),
      milestone({ date: '2026-05-25', id: 'M27', status: 'open', title: 'Fallback open' }),
    ])

    expect(selected?.id).toBe('M28')
  })

  test('prefers the newest active milestone even when it is open and a older in-progress milestone exists', () => {
    const selected = selectLatestActiveMilestone([
      milestone({ date: '2026-05-20', id: 'M24', status: 'in_progress', title: 'Old active' }),
      milestone({ date: '2026-05-31', id: 'M29', status: 'open', title: 'Newer open' }),
      milestone({ date: '2026-05-25', id: 'M27', status: 'proposed', title: 'Ignore' }),
    ])

    expect(selected?.id).toBe('M29')
  })

  test('falls back to the newest open milestone when no in-progress milestone exists', () => {
    const selected = selectLatestActiveMilestone([
      milestone({ date: '2026-05-20', id: 'M24', status: 'open', title: 'Old open' }),
      milestone({ date: '2026-05-31', id: 'M28', status: 'open', title: 'New open' }),
      milestone({ date: '2026-05-25', id: 'M27', status: 'blocked', title: 'Blocked' }),
    ])

    expect(selected?.id).toBe('M28')
  })
})
