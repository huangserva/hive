import { describe, expect, test } from 'vitest'

import {
  COMPOSER_INPUT_MAX_HEIGHT,
  COMPOSER_INPUT_MIN_HEIGHT,
  resolveComposerInputHeight,
} from '../src/lib/composer-height'

describe('resolveComposerInputHeight', () => {
  test('keeps the composer at the minimum height for short content', () => {
    expect(resolveComposerInputHeight(12)).toBe(COMPOSER_INPUT_MIN_HEIGHT)
  })

  test('uses the measured content height while it stays under the cap', () => {
    expect(resolveComposerInputHeight(84)).toBe(84)
  })

  test('caps the composer at the maximum height for long content', () => {
    expect(resolveComposerInputHeight(999)).toBe(COMPOSER_INPUT_MAX_HEIGHT)
  })
})
