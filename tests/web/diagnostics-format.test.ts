import { describe, expect, test } from 'vitest'

import type { DiagnosticsEvent } from '../../web/src/api.js'
import {
  describeSpawnFailure,
  formatPlatformLine,
  isSpawnFailureEvent,
  sentinelTierAccent,
} from '../../web/src/diagnostics/diagnostics-format.js'

describe('describeSpawnFailure', () => {
  test('extracts the worker / command / PATH / error from a spawn_failed payload', () => {
    expect(
      describeSpawnFailure({
        command: 'codex',
        dispatch_id: 'd1',
        error: 'spawn codex ENOENT',
        event: 'dispatch_spawn_failed',
        path: '/usr/bin:/bin',
        task_summary: 'Implement the thing',
        worker: '关羽',
        worker_id: 'worker-a',
      })
    ).toEqual({
      command: 'codex',
      error: 'spawn codex ENOENT',
      path: '/usr/bin:/bin',
      taskSummary: 'Implement the thing',
      worker: '关羽',
    })
  })

  test('falls back to worker_id then "unknown" when the worker name is missing', () => {
    expect(describeSpawnFailure({ worker_id: 'worker-b' }).worker).toBe('worker-b')
    expect(describeSpawnFailure({}).worker).toBe('unknown')
  })

  test('coerces non-string fields to empty strings (never renders [object Object])', () => {
    const view = describeSpawnFailure({ command: 42, error: null, path: undefined })
    expect(view.command).toBe('')
    expect(view.error).toBe('')
    expect(view.path).toBe('')
  })
})

describe('isSpawnFailureEvent', () => {
  const event = (type: string): DiagnosticsEvent => ({
    created_at: 0,
    id: 'x',
    payload: {},
    type,
    workspace_id: 'w',
    workspace_name: 'W',
  })
  test('matches only dispatch_spawn_failed events', () => {
    expect(isSpawnFailureEvent(event('dispatch_spawn_failed'))).toBe(true)
    expect(isSpawnFailureEvent(event('sentinel_alert'))).toBe(false)
  })
})

describe('sentinelTierAccent', () => {
  test('maps each tier to a distinct status color', () => {
    expect(sentinelTierAccent('critical')).toBe('var(--status-red)')
    expect(sentinelTierAccent('warn')).toBe('var(--status-yellow)')
    expect(sentinelTierAccent('info')).toBe('var(--accent)')
  })
})

describe('formatPlatformLine', () => {
  test('renders a compact platform/version/port one-liner', () => {
    expect(
      formatPlatformLine({ appVersion: 'v1.2.3', arch: 'arm64', platform: 'darwin', port: 4010 })
    ).toBe('darwin arm64 · v1.2.3 · :4010')
  })
})
