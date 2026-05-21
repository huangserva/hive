import { describe, expect, test } from 'vitest'

import { chunkFeishuText } from '../../src/server/feishu-transport-utils.js'

const FEISHU_TEXT_LIMIT_BYTES = 30 * 1024
const FEISHU_TEXT_CHUNK_BYTES = 25 * 1024

describe('chunkFeishuText', () => {
  test('short text returns single-element array without prefix', () => {
    const text = 'hello world'
    const chunks = chunkFeishuText(text)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toBe('hello world')
  })

  test('text at exactly 30KB UTF-8 is not split', () => {
    const text = 'a'.repeat(FEISHU_TEXT_LIMIT_BYTES)
    expect(Buffer.byteLength(text, 'utf8')).toBe(FEISHU_TEXT_LIMIT_BYTES)
    const chunks = chunkFeishuText(text)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toBe(text)
  })

  test('text at 30KB + 1 byte is split into multiple chunks', () => {
    const text = 'a'.repeat(FEISHU_TEXT_LIMIT_BYTES + 1)
    expect(Buffer.byteLength(text, 'utf8')).toBe(FEISHU_TEXT_LIMIT_BYTES + 1)
    const chunks = chunkFeishuText(text)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    for (const chunk of chunks) {
      expect(chunk).toMatch(/^\(\d+\/\d+\) a+$/)
    }
  })

  test('31KB ASCII text splits into exactly 2 chunks with (1/2) (2/2) prefixes', () => {
    const text = 'b'.repeat(31 * 1024)
    const chunks = chunkFeishuText(text)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toMatch(/^\(1\/2\) b+$/)
    expect(chunks[1]).toMatch(/^\(2\/2\) b+$/)
  })

  test('each chunk byte length including prefix stays within 30KB', () => {
    const text = 'x'.repeat(60 * 1024)
    const chunks = chunkFeishuText(text)
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, 'utf8')).toBeLessThanOrEqual(FEISHU_TEXT_LIMIT_BYTES)
    }
  })

  test('long text produces chunks whose content reassembles to original', () => {
    const text = 'Z'.repeat(80 * 1024)
    const chunks = chunkFeishuText(text)
    const reassembled = chunks.map((chunk) => chunk.replace(/^\(\d+\/\d+\) /, '')).join('')
    expect(reassembled).toBe(text)
  })

  test('N/M numbers in prefixes match actual chunk count', () => {
    const text = 'c'.repeat(100 * 1024)
    const chunks = chunkFeishuText(text)
    const total = chunks.length
    expect(total).toBeGreaterThanOrEqual(3)
    chunks.forEach((chunk, i) => {
      expect(chunk.startsWith(`(${i + 1}/${total}) `)).toBe(true)
    })
  })

  test('Chinese text over 30KB splits without corrupting characters', () => {
    const char = '\u4e2d'
    const bytePerChar = Buffer.byteLength(char, 'utf8')
    const countNeeded = Math.ceil(FEISHU_TEXT_LIMIT_BYTES / bytePerChar) + 10
    const text = char.repeat(countNeeded)
    expect(Buffer.byteLength(text, 'utf8')).toBeGreaterThan(FEISHU_TEXT_LIMIT_BYTES)

    const chunks = chunkFeishuText(text)
    expect(chunks.length).toBeGreaterThanOrEqual(2)

    for (const chunk of chunks) {
      const content = chunk.replace(/^\(\d+\/\d+\) /, '')
      const roundTripped = Buffer.from(content, 'utf8').toString('utf8')
      expect(roundTripped).toBe(content)
    }
  })

  test('emoji text over 30KB splits without breaking emoji characters', () => {
    const emoji = '\u{1F600}'
    const bytePerEmoji = Buffer.byteLength(emoji, 'utf8')
    const countNeeded = Math.ceil(FEISHU_TEXT_LIMIT_BYTES / bytePerEmoji) + 10
    const text = emoji.repeat(countNeeded)
    expect(Buffer.byteLength(text, 'utf8')).toBeGreaterThan(FEISHU_TEXT_LIMIT_BYTES)

    const chunks = chunkFeishuText(text)
    expect(chunks.length).toBeGreaterThanOrEqual(2)

    for (const chunk of chunks) {
      const content = chunk.replace(/^\(\d+\/\d+\) /, '')
      const roundTripped = Buffer.from(content, 'utf8').toString('utf8')
      expect(roundTripped).toBe(content)
    }
  })

  test('denominator adjusts when prefix width changes from single to double digit', () => {
    const singleChunkBytes = FEISHU_TEXT_CHUNK_BYTES - Buffer.byteLength('(1/9) ', 'utf8')
    const charBytes = 1
    const charsThatNeed9Chunks = singleChunkBytes * 9
    const text = 'd'.repeat(charsThatNeed9Chunks + charBytes)

    const chunks = chunkFeishuText(text)
    for (const chunk of chunks) {
      const match = chunk.match(/^\((\d+)\/(\d+)\)/)
      expect(match).not.toBeNull()
      const denominator = Number.parseInt(match?.[2] ?? '', 10)
      expect(denominator).toBe(chunks.length)
      expect(chunk.startsWith(`(${match?.[1]}/${String(denominator)}) `)).toBe(true)
    }
  })
})
