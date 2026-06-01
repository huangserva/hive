export type TerminalLineTone = 'default' | 'prompt'

export const resolveTerminalLineTone = (line: string): TerminalLineTone => {
  if (line.startsWith('$') || line.startsWith('>')) return 'prompt'
  return 'default'
}
