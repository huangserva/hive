import { describe, expect, test } from 'vitest'

import { parseIdeasDoc } from '../../src/server/pm-ideas-doc.js'

const FULL_IDEAS = `# Ideas Inbox

## inbox（按加入时间倒序）

### 2026-05-20

- 🤔 idea: 用 LLM 做自动 code review
- ~~已验证的方案~~

### 2026-05-18

- idea: 引入 GraphQL 替代 REST

## promoted

### 2026-05-15

- 🤔 idea: ~~迁移到 monorepo~~
`

describe('parseIdeasDoc', () => {
  test('parses inbox and promoted sections', () => {
    const result = parseIdeasDoc(FULL_IDEAS)
    expect(result.inbox).toHaveLength(3)
    expect(result.promoted).toHaveLength(1)
    expect(result.parseError).toBeNull()
  })

  test('extracts text without idea marker', () => {
    const result = parseIdeasDoc(FULL_IDEAS)
    expect(result.inbox[0]?.text).toBe('用 LLM 做自动 code review')
  })

  test('extracts addedAt date from heading', () => {
    const result = parseIdeasDoc(FULL_IDEAS)
    expect(result.inbox[0]?.addedAt).toBe('2026-05-20')
    expect(result.inbox[2]?.addedAt).toBe('2026-05-18')
  })

  test('strips strikethrough from text', () => {
    const result = parseIdeasDoc(FULL_IDEAS)
    expect(result.inbox[1]?.text).toBe('已验证的方案')
    expect(result.inbox[1]?.promoted).toBe(true)
  })

  test('promoted items have promoted=true', () => {
    const result = parseIdeasDoc(FULL_IDEAS)
    expect(result.promoted[0]?.promoted).toBe(true)
  })

  test('empty content returns empty arrays', () => {
    const result = parseIdeasDoc('')
    expect(result.inbox).toEqual([])
    expect(result.promoted).toEqual([])
    expect(result.raw).toBe('')
    expect(result.parseError).toBeNull()
  })

  test('raw preserves original content', () => {
    const result = parseIdeasDoc(FULL_IDEAS)
    expect(result.raw).toBe(FULL_IDEAS)
  })

  test('sequential id generation', () => {
    const result = parseIdeasDoc(FULL_IDEAS)
    expect(result.inbox.map((i) => i.id)).toEqual(['I1', 'I2', 'I3'])
  })
})
