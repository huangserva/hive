import { describe, expect, test } from 'vitest'

import { toThinkingLevelOptions } from '../src/lib/thinking-levels'

describe('thinking level option mapping', () => {
  test('uses labels for display and values for submission', () => {
    expect(
      toThinkingLevelOptions([
        { label: 'Low', value: 'low' },
        { label: 'High Priority', value: 'high' },
      ])
    ).toEqual([
      { label: 'Low', value: 'low' },
      { label: 'High Priority', value: 'high' },
    ])
  })

  test('trims blanks and falls back to value when label is empty', () => {
    expect(
      toThinkingLevelOptions([
        { label: '  ', value: '  deep ' },
        { label: 'Explicit', value: ' explicit ' },
        { label: 'Ignore me', value: '   ' },
      ])
    ).toEqual([
      { label: 'deep', value: 'deep' },
      { label: 'Explicit', value: 'explicit' },
    ])
  })
})
