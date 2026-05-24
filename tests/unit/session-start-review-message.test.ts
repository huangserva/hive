import { describe, expect, test } from 'vitest'

import {
  appendSessionStartReviewMessage,
  SESSION_START_REVIEW_MESSAGE,
} from '../../src/server/session-start-review-message.js'

describe('SESSION_START_REVIEW_MESSAGE', () => {
  test('is a non-empty string', () => {
    expect(typeof SESSION_START_REVIEW_MESSAGE).toBe('string')
    expect(SESSION_START_REVIEW_MESSAGE.length).toBeGreaterThan(0)
  })

  test('contains session start identifier', () => {
    expect(SESSION_START_REVIEW_MESSAGE).toContain('[Hive 系统消息：会话开始]')
  })

  test('contains required file paths', () => {
    expect(SESSION_START_REVIEW_MESSAGE).toContain('.hive/baseline')
    expect(SESSION_START_REVIEW_MESSAGE).toContain('.hive/plan.md')
    expect(SESSION_START_REVIEW_MESSAGE).toContain('.hive/ideas/inbox.md')
    expect(SESSION_START_REVIEW_MESSAGE).toContain('.hive/open-questions.md')
  })

  test('contains once-per-session constraint', () => {
    expect(SESSION_START_REVIEW_MESSAGE).toContain('不要重复 review，本会话只跑一次')
  })
})

describe('appendSessionStartReviewMessage', () => {
  test('appends review message after original text with blank separator', () => {
    const original = 'some bootstrap text'
    const result = appendSessionStartReviewMessage(original)
    expect(result).toContain(original)
    expect(result).toContain('[Hive 系统消息：会话开始]')
    expect(result.indexOf(original)).toBeLessThan(result.indexOf('[Hive 系统消息：会话开始]'))
  })

  test('prepended text and review are not merged on same line', () => {
    const result = appendSessionStartReviewMessage('abc')
    const parts = result.split('[Hive 系统消息：会话开始]')
    expect(parts[0]).toContain('abc')
    expect(parts[0]?.endsWith('\n')).toBe(true)
  })
})
