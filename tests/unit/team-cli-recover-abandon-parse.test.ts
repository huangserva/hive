import { describe, expect, test } from 'vitest'

import {
  ABANDON_USAGE,
  parseAbandonArgs,
  parseRecoverArgs,
  RECOVER_USAGE,
} from '../../src/cli/team.js'

describe('parseRecoverArgs', () => {
  test('parses dispatch id positional', () => {
    expect(parseRecoverArgs(['dispatch-1'])).toEqual({ dispatchId: 'dispatch-1' })
  })

  test('rejects missing or extra args', () => {
    expect(() => parseRecoverArgs([])).toThrow(RECOVER_USAGE)
    expect(() => parseRecoverArgs(['dispatch-1', 'extra'])).toThrow(RECOVER_USAGE)
  })
})

describe('parseAbandonArgs', () => {
  test('requires explicit stopped-worker confirmation', () => {
    expect(parseAbandonArgs(['dispatch-1', '--confirm-worker-stopped'])).toEqual({
      confirmWorkerStopped: true,
      dispatchId: 'dispatch-1',
    })
  })

  test('rejects abandon without confirmation', () => {
    expect(() => parseAbandonArgs(['dispatch-1'])).toThrow(ABANDON_USAGE)
  })
})
