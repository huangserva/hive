import { describe, expect, test, vi } from 'vitest'

import {
  createPendingOutputBuffer,
  type PendingOutputEntry,
} from '../../web/src/terminal/pending-output-buffer.js'

const entry = (chunk: string, acknowledge = vi.fn()): PendingOutputEntry => ({
  acknowledge,
  bytes: chunk.length,
  chunk,
})

describe('createPendingOutputBuffer', () => {
  test('keeps entries under the caps and drains them in order', () => {
    const buffer = createPendingOutputBuffer({ maxBytes: 1000, maxEntries: 10 })
    buffer.push(entry('a'))
    buffer.push(entry('bb'))
    expect(buffer.size()).toBe(2)
    expect(buffer.bytes()).toBe(3)
    const drained = buffer.drain()
    expect(drained.map((e) => e.chunk)).toEqual(['a', 'bb'])
    expect(buffer.size()).toBe(0)
    expect(buffer.bytes()).toBe(0)
  })

  test('drops the OLDEST entries when the entry-count cap is exceeded', () => {
    const buffer = createPendingOutputBuffer({ maxBytes: 1_000_000, maxEntries: 2 })
    const ackA = vi.fn()
    buffer.push(entry('a', ackA))
    buffer.push(entry('b'))
    buffer.push(entry('c')) // over cap → oldest ('a') dropped
    expect(buffer.size()).toBe(2)
    expect(buffer.droppedCount()).toBe(1)
    expect(buffer.drain().map((e) => e.chunk)).toEqual(['b', 'c'])
    // The dropped entry's bytes are acknowledged so the server window advances.
    expect(ackA).toHaveBeenCalledWith(1)
  })

  test('drops oldest by BYTE total and acknowledges dropped bytes', () => {
    const buffer = createPendingOutputBuffer({ maxBytes: 5, maxEntries: 1000 })
    const ackOld = vi.fn()
    buffer.push(entry('aaa', ackOld)) // 3 bytes
    buffer.push(entry('bbb')) // +3 = 6 > 5 → drop 'aaa'
    expect(buffer.bytes()).toBe(3)
    expect(buffer.droppedBytes()).toBe(3)
    expect(ackOld).toHaveBeenCalledWith(3)
    expect(buffer.drain().map((e) => e.chunk)).toEqual(['bbb'])
  })

  test('always keeps at least the newest entry, even if it alone exceeds maxBytes', () => {
    const buffer = createPendingOutputBuffer({ maxBytes: 4, maxEntries: 1000 })
    buffer.push(entry('aa'))
    buffer.push(entry('huge-chunk-way-over-cap'))
    // older dropped, newest retained (can't be split)
    expect(buffer.size()).toBe(1)
    expect(buffer.drain().map((e) => e.chunk)).toEqual(['huge-chunk-way-over-cap'])
  })

  test('clear() discards without acknowledging (used on reconnect)', () => {
    const buffer = createPendingOutputBuffer({ maxBytes: 1000, maxEntries: 10 })
    const ack = vi.fn()
    buffer.push(entry('a', ack))
    buffer.clear()
    expect(buffer.size()).toBe(0)
    expect(buffer.bytes()).toBe(0)
    expect(ack).not.toHaveBeenCalled()
  })
})
