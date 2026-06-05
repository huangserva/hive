import { describe, expect, test } from 'vitest'

import { sanitizeForSpeech } from '../../src/server/speech-text-sanitizer.js'

describe('speech text sanitizer', () => {
  test('replaces URLs, markdown, symbols, hashes, and filenames with speakable text', () => {
    const original =
      '✅ **已完成** 下载链接：https://example.com/builds/hive-2.7.4-a1b2c3d4.apk\n' +
      '`5aea765` / app-release-2.7.4-a1b2c3d4.apk\n' +
      '```ts\nconst token = "abc123def456ghi789"\n```'

    expect(sanitizeForSpeech(original)).toBe(
      '完成 已完成 下载链接：链接 一个版本 一个文件 代码片段'
    )
    expect(original).toContain('https://example.com')
  })

  test('keeps ordinary human text readable', () => {
    expect(sanitizeForSpeech('我已经处理完，下一步等你确认。')).toBe(
      '我已经处理完，下一步等你确认。'
    )
  })
})
