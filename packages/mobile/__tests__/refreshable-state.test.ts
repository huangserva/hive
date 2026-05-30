import { describe, expect, test } from 'vitest'

import {
  initialRefreshable,
  onFetchFailure,
  onFetchStart,
  onFetchSuccess,
} from '../src/cockpit/refreshable-state'

describe('cockpit refreshable load state', () => {
  test('initial state: loading (first paint shows spinner, not blank), no data', () => {
    const s = initialRefreshable<{ n: number }>()
    expect(s).toEqual({ data: null, error: null, hasData: false, loading: true, refreshing: false })
  })

  test('first fetch start (no data yet) → loading, not refreshing', () => {
    const s = onFetchStart(initialRefreshable<number>())
    expect(s.loading).toBe(true)
    expect(s.refreshing).toBe(false)
  })

  test('refetch start when data already present → refreshing, NOT loading (no blank screen)', () => {
    const withData = onFetchSuccess(initialRefreshable<number>(), 42)
    const s = onFetchStart(withData)
    expect(s.loading).toBe(false)
    expect(s.refreshing).toBe(true)
    expect(s.data).toBe(42) // 旧数据保留
  })

  test('success → sets data, marks hasData, clears error, stops spinners', () => {
    const s = onFetchSuccess(onFetchStart(initialRefreshable<string>()), 'ok')
    expect(s).toEqual({
      data: 'ok',
      error: null,
      hasData: true,
      loading: false,
      refreshing: false,
    })
  })

  test('failure WITH prior data → keeps old data + sets error, never blanks', () => {
    const withData = onFetchSuccess(initialRefreshable<string>(), 'old')
    const s = onFetchFailure(onFetchStart(withData), 'network down')
    expect(s.data).toBe('old')
    expect(s.hasData).toBe(true)
    expect(s.error).toBe('network down')
    expect(s.loading).toBe(false)
    expect(s.refreshing).toBe(false)
  })

  test('failure with no prior data → no data + error, loading stops (shows error, not infinite spinner)', () => {
    const s = onFetchFailure(onFetchStart(initialRefreshable<string>()), 'failed')
    expect(s.data).toBeNull()
    expect(s.hasData).toBe(false)
    expect(s.error).toBe('failed')
    expect(s.loading).toBe(false)
  })

  test('success after a failure clears the error', () => {
    const failed = onFetchFailure(initialRefreshable<number>(), 'boom')
    const recovered = onFetchSuccess(failed, 7)
    expect(recovered.error).toBeNull()
    expect(recovered.data).toBe(7)
  })
})
