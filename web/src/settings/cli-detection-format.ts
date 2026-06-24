// Pure helpers for the CLI-detection settings UI (wizard card + Setup tab).
// Kept out of the React components so the install-command rendering and status
// summary can be unit-tested without a DOM.

import type { CliAgentDetection, CliInstallCommand } from '../api.js'

const CLI_DISPLAY_NAMES: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
}

export const cliDisplayName = (presetId: string): string => CLI_DISPLAY_NAMES[presetId] ?? presetId

// Render an install plan as a copy-pasteable shell command, e.g.
// { command: 'npm', args: ['install', '-g', '@openai/codex'] } → "npm install -g @openai/codex".
export const formatInstallCommand = (plan: CliInstallCommand | null): string => {
  if (!plan) return ''
  return [plan.command, ...plan.args].join(' ').trim()
}

// One-line "X of N installed" summary for the panel header.
export const summarizeCliStatus = (
  agents: CliAgentDetection[]
): { installed: number; total: number } => ({
  installed: agents.filter((agent) => agent.installed).length,
  total: agents.length,
})
