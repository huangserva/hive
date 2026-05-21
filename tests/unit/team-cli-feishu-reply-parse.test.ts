import { describe, expect, test } from 'vitest'

import { FEISHU_REPLY_USAGE, parseFeishuReplyArgs } from '../../src/cli/team.js'

describe('parseFeishuReplyArgs', () => {
  test('single positional text without chat flag', () => {
    const result = parseFeishuReplyArgs(['hello'])
    expect(result).toEqual({ text: 'hello', chatId: undefined })
  })

  test('--chat flag before text', () => {
    const result = parseFeishuReplyArgs(['--chat', 'oc_x', 'hello'])
    expect(result).toEqual({ text: 'hello', chatId: 'oc_x' })
  })

  test('multiple positional args are joined with space', () => {
    const result = parseFeishuReplyArgs(['hello', 'world'])
    expect(result).toEqual({ text: 'hello world', chatId: undefined })
  })

  test('--chat with multiple positional words', () => {
    const result = parseFeishuReplyArgs(['--chat', 'oc_x', 'hello', 'world'])
    expect(result).toEqual({ text: 'hello world', chatId: 'oc_x' })
  })

  test('--chat flag after positional text', () => {
    const result = parseFeishuReplyArgs(['hello', '--chat', 'oc_x'])
    expect(result).toEqual({ text: 'hello', chatId: 'oc_x' })
  })

  test('--chat without value throws with usage', () => {
    expect(() => parseFeishuReplyArgs(['--chat'])).toThrow(FEISHU_REPLY_USAGE)
  })

  test('--chat with flag-like value throws with usage', () => {
    expect(() => parseFeishuReplyArgs(['--chat', '--text'])).toThrow(FEISHU_REPLY_USAGE)
  })

  test('empty args throws Missing text', () => {
    expect(() => parseFeishuReplyArgs([])).toThrow('Missing <text>')
  })

  test('unknown flag throws Unknown argument', () => {
    expect(() => parseFeishuReplyArgs(['--unknown', 'foo'])).toThrow('Unknown argument: --unknown')
  })
})
