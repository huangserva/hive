import { describe, expect, test } from 'vitest'

import { buildAgentCliInstallPlan, detectAgentCli } from '../../src/server/agent-cli-installer.js'

describe('agent CLI installer planning', () => {
  test('detects a preset CLI from PATH using an injected command resolver', () => {
    expect(
      detectAgentCli('claude', {
        commandExists: (command) => command === 'claude',
        versionReader: () => null,
      })
    ).toEqual({
      command: 'claude',
      installed: true,
      path: 'claude',
      presetId: 'claude',
      version: null,
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
      path: null,
      presetId: 'codex',
      version: null,
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
      path: null,
      presetId: 'custom-tool',
      version: null,
    })
  })

  test('reports resolved absolute path and version for a manually pointed CLI', () => {
    expect(
      detectAgentCli('codex', {
        commandOverride: '/opt/hive/bin/codex',
        commandExists: (command) => command === '/opt/hive/bin/codex',
        versionReader: (command) => (command === '/opt/hive/bin/codex' ? 'codex 1.2.3' : null),
      })
    ).toEqual({
      command: '/opt/hive/bin/codex',
      installed: true,
      path: '/opt/hive/bin/codex',
      presetId: 'codex',
      version: 'codex 1.2.3',
    })
  })
})
