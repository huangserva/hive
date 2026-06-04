import { describe, expect, test, vi } from 'vitest'

import { runUiOperationSafely, withUiOperationTimeout } from '../src/lib/ui-operation-timeout'

describe('withUiOperationTimeout', () => {
  test('returns the operation result before the timeout', async () => {
    await expect(withUiOperationTimeout(Promise.resolve('ok'), { label: 'refresh' })).resolves.toBe(
      'ok'
    )
  })

  test('rejects after the timeout so loading state can stop', async () => {
    vi.useFakeTimers()
    const operation = withUiOperationTimeout(new Promise<string>(() => {}), {
      label: 'refresh',
      timeoutMs: 100,
    })
    const assertion = expect(operation).rejects.toThrow('refresh timed out')

    await vi.advanceTimersByTimeAsync(100)

    await assertion
    vi.useRealTimers()
  })

  test('absorbs a late rejection after the UI timeout wins', async () => {
    vi.useFakeTimers()
    const source = new Promise<string>((_resolve, reject) => {
      setTimeout(() => reject(new Error('late network failure')), 200)
    })
    const operation = withUiOperationTimeout(source, { label: 'refresh', timeoutMs: 100 })
    const assertion = expect(operation).rejects.toThrow('refresh timed out')

    await vi.advanceTimersByTimeAsync(100)
    await assertion
    await vi.advanceTimersByTimeAsync(100)

    vi.useRealTimers()
  })

  test('safe UI operation consumes timeout errors for fire-and-forget handlers', async () => {
    vi.useFakeTimers()
    const operation = runUiOperationSafely(new Promise<string>(() => {}), {
      label: 'connection switch',
      timeoutMs: 100,
    })

    await vi.advanceTimersByTimeAsync(100)

    await expect(operation).resolves.toEqual({
      error: expect.objectContaining({ name: 'UiOperationTimeoutError' }),
      ok: false,
    })
    vi.useRealTimers()
  })

  test('safe UI operation consumes ordinary operation failures', async () => {
    await expect(
      runUiOperationSafely(Promise.reject(new Error('network down')), {
        label: 'status refresh',
      })
    ).resolves.toEqual({
      error: expect.objectContaining({ message: 'network down' }),
      ok: false,
    })
  })
})
