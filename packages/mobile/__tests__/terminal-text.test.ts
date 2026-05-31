import { describe, expect, it } from 'vitest'

import { cleanTerminalLines, sanitizeTerminalLine } from '../src/lib/terminal-text'

const ESC = String.fromCharCode(0x1b)
const BEL = String.fromCharCode(0x07)

describe('sanitizeTerminalLine', () => {
  it('leaves plain text untouched', () => {
    expect(sanitizeTerminalLine('services started ok')).toBe('services started ok')
  })

  it('strips CSI color/SGR codes without eating the text', () => {
    expect(sanitizeTerminalLine(`${ESC}[31mservices${ESC}[0m started`)).toBe('services started')
    expect(sanitizeTerminalLine(`${ESC}[38;2;255;0;0mred${ESC}[0m`)).toBe('red')
  })

  it('strips cursor-move / clear CSI sequences', () => {
    expect(sanitizeTerminalLine(`${ESC}[2K${ESC}[1Gservices`)).toBe('services')
    expect(sanitizeTerminalLine(`${ESC}[?25lhidden${ESC}[?25h`)).toBe('hidden')
  })

  it('strips OSC sequences (title / hyperlink) terminated by BEL or ST', () => {
    expect(sanitizeTerminalLine(`${ESC}]0;window title${BEL}services`)).toBe('services')
    expect(sanitizeTerminalLine(`${ESC}]8;;https://x${BEL}link${ESC}]8;;${BEL}`)).toBe('link')
  })

  it('strips charset / short escapes (ESC(B, ESC c)', () => {
    expect(sanitizeTerminalLine(`${ESC}(Bservices`)).toBe('services')
    expect(sanitizeTerminalLine(`${ESC}cservices`)).toBe('services')
  })

  it('resolves carriage-return overwrites (terminal shows only the final write)', () => {
    // 一个被原地重绘的进度/拼写行：旧内容被 \r 之后的新内容覆盖。
    expect(sanitizeTerminalLine('s1rvices\rservices')).toBe('services')
    expect(sanitizeTerminalLine('loading...\rdone')).toBe('done')
  })

  it('removes stray control characters but keeps tabs', () => {
    expect(sanitizeTerminalLine(`a${String.fromCharCode(8)}b${String.fromCharCode(0)}c`)).toBe(
      'abc'
    )
    expect(sanitizeTerminalLine('col1\tcol2')).toBe('col1\tcol2')
  })

  it('trims trailing whitespace but preserves leading indentation', () => {
    expect(sanitizeTerminalLine('  indented   ')).toBe('  indented')
  })

  it('does not corrupt CJK / brackets', () => {
    expect(sanitizeTerminalLine(`${ESC}[32m[附件] 服务已启动${ESC}[0m`)).toBe('[附件] 服务已启动')
  })
})

describe('cleanTerminalLines', () => {
  it('sanitizes every line', () => {
    expect(cleanTerminalLines([`${ESC}[31mone${ESC}[0m`, 'two', `three${ESC}[K`])).toEqual([
      'one',
      'two',
      'three',
    ])
  })

  it('keeps only the most recent maxLines', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`)
    expect(cleanTerminalLines(lines, 3)).toEqual(['line 7', 'line 8', 'line 9'])
  })
})
