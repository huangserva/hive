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

  test('--message-id flag before text', () => {
    const result = parseFeishuReplyArgs(['--message-id', 'om_x', 'hello'])
    expect(result.messageId).toBe('om_x')
    expect(result.text).toBe('hello')
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

  // M44 钟馗第二轮 blocking #1：CLI --file 用例覆盖（产品反则 CLI 不传 file 字段，下面断言挂红）。
  test('M44 --file 后跟正文 caption → file 解析 + text 当 caption', () => {
    const result = parseFeishuReplyArgs(['--file', '/path/foo.mp4', 'see this'])
    expect(result.file).toBe('/path/foo.mp4')
    expect(result.text).toBe('see this')
  })

  test('M44 --file 没跟正文 → file 解析 + text 为空（caption 选填）', () => {
    const result = parseFeishuReplyArgs(['--file', '/path/foo.mp4'])
    expect(result.file).toBe('/path/foo.mp4')
    expect(result.text).toBe('')
  })

  test('M44 --file + --chat + caption 组合', () => {
    const result = parseFeishuReplyArgs(['--chat', 'oc_x', '--file', '/path/foo.mp4', '看一下'])
    expect(result.chatId).toBe('oc_x')
    expect(result.file).toBe('/path/foo.mp4')
    expect(result.text).toBe('看一下')
  })

  test('M44 --file 没值 → throws with usage', () => {
    expect(() => parseFeishuReplyArgs(['--file'])).toThrow(FEISHU_REPLY_USAGE)
  })

  test('M44 --file 后跟下一个 flag → throws（防误吞 --chat 当 file path）', () => {
    expect(() => parseFeishuReplyArgs(['--file', '--chat', 'oc_x', 'hi'])).toThrow(
      FEISHU_REPLY_USAGE
    )
  })

  test('M44 既没 --file 又没 text → Missing <text>', () => {
    expect(() => parseFeishuReplyArgs([])).toThrow('Missing <text>')
  })

  test('M44 旧路径不带 --file 时 file 字段缺省（向后兼容）', () => {
    const result = parseFeishuReplyArgs(['hello'])
    expect(result.file).toBeUndefined()
    expect(result.text).toBe('hello')
  })
})
