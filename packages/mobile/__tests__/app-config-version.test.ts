import { describe, expect, test } from 'vitest'

import config from '../app.config'

describe('mobile app config version', () => {
  test('matches the current release version shown in Settings', () => {
    expect(config.version).toBe('2.6.10')
  })
})
