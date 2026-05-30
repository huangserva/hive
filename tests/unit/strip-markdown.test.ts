import { describe, expect, it } from 'vitest'

import { stripInlineMarkdown } from '../../packages/mobile/src/lib/strip-markdown'

describe('stripInlineMarkdown', () => {
  it('removes markdown markers from inline text', () => {
    expect(stripInlineMarkdown('**maintenance + PM 体系 rollout**')).toBe(
      'maintenance + PM 体系 rollout'
    )
  })
})
