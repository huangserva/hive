import { describe, expect, test } from 'vitest'

import type { CliAgentDetection } from '../../web/src/api.js'
import {
  cliDisplayName,
  formatInstallCommand,
  summarizeCliStatus,
} from '../../web/src/settings/cli-detection-format.js'

describe('formatInstallCommand', () => {
  test('joins command + args into a copy-pasteable shell line', () => {
    expect(
      formatInstallCommand({
        args: ['install', '-g', '@openai/codex'],
        command: 'npm',
        description: 'Install Codex CLI via npm.',
      })
    ).toBe('npm install -g @openai/codex')
  })

  test('handles installers with no args', () => {
    expect(
      formatInstallCommand({ args: [], command: 'brew install opencode', description: 'x' })
    ).toBe('brew install opencode')
  })

  test('returns empty string when there is no install plan (already installed)', () => {
    expect(formatInstallCommand(null)).toBe('')
  })
})

describe('cliDisplayName', () => {
  test('maps known preset ids to friendly names', () => {
    expect(cliDisplayName('claude')).toBe('Claude Code')
    expect(cliDisplayName('codex')).toBe('Codex')
    expect(cliDisplayName('opencode')).toBe('OpenCode')
    expect(cliDisplayName('gemini')).toBe('Gemini')
  })

  test('falls back to the raw id for unknown presets', () => {
    expect(cliDisplayName('mystery')).toBe('mystery')
  })
})

describe('summarizeCliStatus', () => {
  const agent = (presetId: string, installed: boolean): CliAgentDetection => ({
    command: presetId,
    installPlan: installed ? null : { args: [], command: 'npm', description: '' },
    installed,
    path: installed ? `/usr/local/bin/${presetId}` : null,
    presetId,
    version: installed ? '1.0.0' : null,
  })

  test('counts installed vs total', () => {
    expect(
      summarizeCliStatus([
        agent('claude', true),
        agent('codex', false),
        agent('opencode', true),
        agent('gemini', false),
      ])
    ).toEqual({ installed: 2, total: 4 })
  })

  test('empty list is zero of zero', () => {
    expect(summarizeCliStatus([])).toEqual({ installed: 0, total: 0 })
  })
})
