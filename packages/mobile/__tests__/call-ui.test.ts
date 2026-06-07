import { describe, expect, test } from 'vitest'

import {
  type CallPhase,
  formatCallDuration,
  isConnectedPhase,
  resolveCallPhase,
} from '../src/lib/call-ui'

describe('formatCallDuration', () => {
  test('formats sub-minute durations as mm:ss', () => {
    expect(formatCallDuration(0)).toBe('00:00')
    expect(formatCallDuration(4_000)).toBe('00:04')
    expect(formatCallDuration(59_000)).toBe('00:59')
  })

  test('rolls over into minutes', () => {
    expect(formatCallDuration(60_000)).toBe('01:00')
    expect(formatCallDuration(84_000)).toBe('01:24')
    expect(formatCallDuration(10 * 60_000 + 7_000)).toBe('10:07')
  })

  test('floors partial seconds and clamps negatives to 00:00', () => {
    expect(formatCallDuration(4_999)).toBe('00:04')
    expect(formatCallDuration(-1_000)).toBe('00:00')
  })
})

describe('resolveCallPhase', () => {
  test('ended wins over every hook status (local post-hangup display state)', () => {
    expect(
      resolveCallPhase({ callStatePhase: 'processing', ended: true, status: 'connected' })
    ).toBe('ended')
    expect(resolveCallPhase({ callStatePhase: 'responding', ended: true, status: 'error' })).toBe(
      'ended'
    )
  })

  test('error maps to the error phase when not ended', () => {
    expect(resolveCallPhase({ ended: false, status: 'error' })).toBe('error')
  })

  test('connected follows the latest server voice_call_state phase', () => {
    expect(
      resolveCallPhase({ callStatePhase: 'listening', ended: false, status: 'connected' })
    ).toBe('listening')
    expect(resolveCallPhase({ callStatePhase: 'heard', ended: false, status: 'connected' })).toBe(
      'heard'
    )
    expect(
      resolveCallPhase({ callStatePhase: 'processing', ended: false, status: 'connected' })
    ).toBe('processing')
    expect(
      resolveCallPhase({ callStatePhase: 'responding', ended: false, status: 'connected' })
    ).toBe('responding')
  })

  test('idle and connecting both show the connecting (dial-out) phase', () => {
    expect(resolveCallPhase({ ended: false, status: 'idle' })).toBe('connecting')
    expect(resolveCallPhase({ ended: false, status: 'connecting' })).toBe('connecting')
  })
})

describe('isConnectedPhase', () => {
  test('only the four connected sub-states count as connected', () => {
    const phases: CallPhase[] = [
      'connecting',
      'listening',
      'heard',
      'processing',
      'responding',
      'error',
      'ended',
    ]
    expect(phases.filter(isConnectedPhase)).toEqual([
      'listening',
      'heard',
      'processing',
      'responding',
    ])
  })
})
