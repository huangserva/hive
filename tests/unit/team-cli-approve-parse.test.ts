import { describe, expect, test } from 'vitest'

import { APPROVE_USAGE, parseApproveArgs } from '../../src/cli/team.js'

describe('parseApproveArgs', () => {
  test('single positional becomes action, default risk high, no target, no chatId', () => {
    const result = parseApproveArgs(['delete old files'])
    expect(result).toEqual({
      action: 'delete old files',
      chatId: undefined,
      risk: 'high',
      target: null,
    })
  })

  test('--risk medium overrides default', () => {
    const result = parseApproveArgs(['delete old files', '--risk', 'medium'])
    expect(result).toEqual({
      action: 'delete old files',
      chatId: undefined,
      risk: 'medium',
      target: null,
    })
  })

  test('--risk invalid throws', () => {
    expect(() => parseApproveArgs(['delete old files', '--risk', 'invalid'])).toThrow(
      '--risk must be high or medium'
    )
  })

  test('--target sets target name', () => {
    const result = parseApproveArgs(['delete old files', '--target', '关羽'])
    expect(result).toEqual({
      action: 'delete old files',
      chatId: undefined,
      risk: 'high',
      target: '关羽',
    })
  })

  test('--chat sets chatId', () => {
    const result = parseApproveArgs(['delete old files', '--chat', 'oc_x'])
    expect(result).toEqual({
      action: 'delete old files',
      chatId: 'oc_x',
      risk: 'high',
      target: null,
    })
  })

  test('flags can appear in any order', () => {
    const result = parseApproveArgs([
      '--chat',
      'oc_x',
      '--risk',
      'medium',
      '--target',
      'bob',
      'deploy',
    ])
    expect(result).toEqual({
      action: 'deploy',
      chatId: 'oc_x',
      risk: 'medium',
      target: 'bob',
    })
  })

  test('empty args throws Missing action', () => {
    expect(() => parseApproveArgs([])).toThrow('Missing <action>')
  })

  test('--chat without value throws with APPROVE_USAGE', () => {
    expect(() => parseApproveArgs(['deploy', '--chat'])).toThrow(APPROVE_USAGE)
  })

  test('--unknown throws Unknown argument', () => {
    expect(() => parseApproveArgs(['deploy', '--unknown'])).toThrow('Unknown argument: --unknown')
  })

  test('multiple positional words are joined with space as action', () => {
    const result = parseApproveArgs(['delete', 'all', 'temp', 'files'])
    expect(result.action).toBe('delete all temp files')
  })
})
