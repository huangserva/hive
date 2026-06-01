import { describe, expect, it } from 'vitest'

import { resolveTerminalLineTone } from '../src/lib/agent-terminal-display'

describe('resolveTerminalLineTone', () => {
  it('highlights shell prompts only', () => {
    expect(resolveTerminalLineTone('$ pnpm test')).toBe('prompt')
    expect(resolveTerminalLineTone('> ready')).toBe('prompt')
  })

  it('does not infer terminal error color from plain text', () => {
    expect(resolveTerminalLineTone('sqlite3 "$DB" "SELECT name FROM stderr"')).toBe('default')
    expect(resolveTerminalLineTone('error: command failed')).toBe('default')
  })
})
