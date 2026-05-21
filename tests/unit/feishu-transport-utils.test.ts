import { describe, expect, test } from 'vitest'

import {
  type FeishuMention,
  type FeishuMessageSender,
  getSenderUserId,
  parseTextContent,
  stripLeadingMentions,
} from '../../src/server/feishu-transport-utils.js'

describe('stripLeadingMentions', () => {
  test('returns trimmed text when mentions array is empty', () => {
    expect(stripLeadingMentions('  hello  ', [])).toBe('hello  ')
  })

  test('strips single <at> tag before text', () => {
    const text = '<at user_id="ou_xxx">关羽</at> 你好'
    const mentions: FeishuMention[] = [{ id: { open_id: 'ou_xxx' }, key: '@_user_1', name: '关羽' }]
    expect(stripLeadingMentions(text, mentions)).toBe('你好')
  })

  test('strips multiple consecutive <at> tags', () => {
    const text = '<at user_id="ou_a">A</at><at user_id="ou_b">B</at> hello'
    const mentions: FeishuMention[] = [
      { id: { open_id: 'ou_a' }, key: '@_user_1', name: 'A' },
      { id: { open_id: 'ou_b' }, key: '@_user_2', name: 'B' },
    ]
    expect(stripLeadingMentions(text, mentions)).toBe('hello')
  })

  test('strips mention.key when it appears as prefix', () => {
    const text = '@_user_1 hello'
    const mentions: FeishuMention[] = [{ id: { open_id: 'ou_xxx' }, key: '@_user_1', name: '关羽' }]
    expect(stripLeadingMentions(text, mentions)).toBe('hello')
  })

  test('strips @mention.name prefix', () => {
    const text = '@张三 你好'
    const mentions: FeishuMention[] = [{ id: { open_id: 'ou_xxx' }, key: '@_user_1', name: '张三' }]
    expect(stripLeadingMentions(text, mentions)).toBe('你好')
  })

  test('does not strip mention appearing in the middle of text', () => {
    const text = 'hello @张三 world'
    const mentions: FeishuMention[] = [{ id: { open_id: 'ou_xxx' }, key: '@_user_1', name: '张三' }]
    expect(stripLeadingMentions(text, mentions)).toBe('hello @张三 world')
  })

  test('strips <at> tag plus mention.name double layer', () => {
    const text = '<at user_id="ou_x">Bob</at> @Bob hello'
    const mentions: FeishuMention[] = [{ id: { open_id: 'ou_x' }, key: '@_user_1', name: 'Bob' }]
    expect(stripLeadingMentions(text, mentions)).toBe('hello')
  })

  test('trims leading whitespace after all stripping', () => {
    const text = '   <at user_id="ou_x">A</at>   text'
    const mentions: FeishuMention[] = [{ id: { open_id: 'ou_x' }, key: '@_user_1', name: 'A' }]
    expect(stripLeadingMentions(text, mentions)).toBe('text')
  })

  test('returns empty string when text is all mentions', () => {
    const text = '<at user_id="ou_x">A</at>'
    const mentions: FeishuMention[] = [{ id: { open_id: 'ou_x' }, key: '@_user_1', name: 'A' }]
    expect(stripLeadingMentions(text, mentions)).toBe('')
  })
})

describe('parseTextContent', () => {
  test('returns text string from valid JSON', () => {
    expect(parseTextContent('{"text":"hello"}')).toBe('hello')
  })

  test('returns null when text field is a number', () => {
    expect(parseTextContent('{"text":123}')).toBeNull()
  })

  test('returns null when text field is null', () => {
    expect(parseTextContent('{"text":null}')).toBeNull()
  })

  test('returns null when text field is an object', () => {
    expect(parseTextContent('{"text":{"nested":true}}')).toBeNull()
  })

  test('returns null when text field is missing', () => {
    expect(parseTextContent('{"other":"value"}')).toBeNull()
  })

  test('throws on invalid JSON', () => {
    expect(() => parseTextContent('{bad json')).toThrow(SyntaxError)
  })

  test('preserves unicode in text field', () => {
    expect(parseTextContent('{"text":"你好世界"}')).toBe('你好世界')
  })
})

describe('getSenderUserId', () => {
  test('returns user_id when present', () => {
    const sender = { sender_id: { user_id: 'ou_abc', open_id: 'om_xyz' } } as FeishuMessageSender
    expect(getSenderUserId(sender)).toBe('ou_abc')
  })

  test('falls back to open_id when user_id is missing', () => {
    const sender = { sender_id: { open_id: 'om_xyz', union_id: 'on_uuu' } } as FeishuMessageSender
    expect(getSenderUserId(sender)).toBe('om_xyz')
  })

  test('falls back to union_id when user_id and open_id are missing', () => {
    const sender = { sender_id: { union_id: 'on_uuu' } } as FeishuMessageSender
    expect(getSenderUserId(sender)).toBe('on_uuu')
  })

  test('returns "unknown" when all id fields are missing', () => {
    const sender = { sender_id: {} } as FeishuMessageSender
    expect(getSenderUserId(sender)).toBe('unknown')
  })

  test('returns "unknown" when sender_id is undefined', () => {
    const sender = { sender_id: undefined } as unknown as FeishuMessageSender
    expect(getSenderUserId(sender)).toBe('unknown')
  })
})
