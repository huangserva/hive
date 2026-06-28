import { describe, expect, test } from 'vitest'

import { parseTerminalControlFrame } from '../../web/src/terminal/terminal-control-frame.js'

describe('parseTerminalControlFrame', () => {
  test('accepts a well-formed restore / error / exit frame', () => {
    expect(parseTerminalControlFrame(JSON.stringify({ snapshot: 'hi', type: 'restore' }))).toEqual({
      snapshot: 'hi',
      type: 'restore',
    })
    expect(parseTerminalControlFrame(JSON.stringify({ message: 'boom', type: 'error' }))).toEqual({
      message: 'boom',
      type: 'error',
    })
    expect(parseTerminalControlFrame(JSON.stringify({ code: 0, type: 'exit' }))).toEqual({
      code: 0,
      type: 'exit',
    })
    expect(parseTerminalControlFrame(JSON.stringify({ code: null, type: 'exit' }))).toEqual({
      code: null,
      type: 'exit',
    })
  })

  test('rejects a restore whose snapshot is not a string (stale schema)', () => {
    expect(
      parseTerminalControlFrame(JSON.stringify({ snapshot: { obj: 1 }, type: 'restore' }))
    ).toBeNull()
    expect(parseTerminalControlFrame(JSON.stringify({ type: 'restore' }))).toBeNull()
  })

  test('rejects error/exit frames with the wrong field types', () => {
    expect(parseTerminalControlFrame(JSON.stringify({ message: 42, type: 'error' }))).toBeNull()
    expect(parseTerminalControlFrame(JSON.stringify({ code: 'nope', type: 'exit' }))).toBeNull()
  })

  test('rejects malformed JSON, non-strings and unknown types', () => {
    expect(parseTerminalControlFrame('not json {')).toBeNull()
    expect(parseTerminalControlFrame(42)).toBeNull()
    expect(parseTerminalControlFrame(null)).toBeNull()
    expect(parseTerminalControlFrame(JSON.stringify({ type: 'something-else' }))).toBeNull()
    expect(parseTerminalControlFrame(JSON.stringify(['array']))).toBeNull()
  })
})
