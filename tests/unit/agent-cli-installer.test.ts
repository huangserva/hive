import { describe, expect, test } from 'vitest'

import { buildAgentCliInstallPlan, detectAgentCli } from '../../src/server/agent-cli-installer.js'

describe('agent CLI installer planning', () => {
  test('detects a preset CLI from PATH using an injected command resolver', () => {
    expect(
      detectAgentCli('claude', {
        commandExists: (command) => command === 'claude',
      })
    ).toEqual({
      command: 'claude',
      installed: true,
      presetId: 'claude',
    })
  })

  test('returns an official install plan when a known preset CLI is missing', () => {
    expect(
      buildAgentCliInstallPlan('codex', {
        commandExists: () => false,
      })
    ).toEqual({
      command: 'codex',
      install: {
        args: ['install', '-g', '@openai/codex'],
        command: 'npm',
        description: 'Install Codex CLI via npm.',
      },
      installed: false,
      presetId: 'codex',
    })
  })

  test('does not invent installers for custom presets', () => {
    expect(
      buildAgentCliInstallPlan('custom-tool', {
        commandExists: () => false,
      })
    ).toEqual({
      command: 'custom-tool',
      install: null,
      installed: false,
      presetId: 'custom-tool',
    })
  })
})
