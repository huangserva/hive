import { afterEach, describe, expect, test, vi } from 'vitest'

import { createUuid } from '../src/api/uuid.js'

describe('createUuid', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('uses crypto.randomUUID when available', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => 'fixed-random-uuid',
    })

    expect(createUuid()).toBe('fixed-random-uuid')
  })

  test('uses getRandomValues to create UUIDv4 when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
        return bytes
      },
    })

    expect(createUuid()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
  })

  test('falls back to a monotonic id when crypto is unavailable', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    vi.stubGlobal('crypto', undefined)

    const first = createUuid()
    const second = createUuid()
    expect(first).toMatch(/^uuid-1700000000000-\d+$/)
    expect(second).toMatch(/^uuid-1700000000000-\d+$/)
    expect(second).not.toBe(first)
  })
})
