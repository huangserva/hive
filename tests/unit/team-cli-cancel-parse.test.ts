import { describe, expect, test } from 'vitest'

import { CANCEL_USAGE, parseCancelArgs } from '../../src/cli/team.js'

describe('parseCancelArgs', () => {
  test('parses --dispatch and reason', () => {
    const result = parseCancelArgs(['--dispatch', 'abc123', 'wrong', 'direction'])
    expect(result).toEqual({ dispatchId: 'abc123', reason: 'wrong direction' })
  })

  test('missing --dispatch throws with CANCEL_USAGE', () => {
    expect(() => parseCancelArgs(['some reason'])).toThrow(CANCEL_USAGE)
  })

  test('--dispatch without value throws', () => {
    expect(() => parseCancelArgs(['--dispatch'])).toThrow(CANCEL_USAGE)
  })

  test('--dispatch with flag-like value throws', () => {
    expect(() => parseCancelArgs(['--dispatch', '--reason'])).toThrow(CANCEL_USAGE)
  })

  test('missing reason throws Missing reason', () => {
    expect(() => parseCancelArgs(['--dispatch', 'abc123'])).toThrow('Missing <reason>')
  })

  test('multi-word reason is joined with space', () => {
    const result = parseCancelArgs(['--dispatch', 'id1', 'task', 'is', 'stuck'])
    expect(result.reason).toBe('task is stuck')
  })

  test('unknown flag throws Unknown argument', () => {
    expect(() => parseCancelArgs(['--dispatch', 'id1', '--unknown', 'reason'])).toThrow(
      'Unknown argument: --unknown'
    )
  })

  test('flags can appear in any order — reason before --dispatch', () => {
    const result = parseCancelArgs(['task', 'stuck', '--dispatch', 'id1'])
    expect(result).toEqual({ dispatchId: 'id1', reason: 'task stuck' })
  })
})
