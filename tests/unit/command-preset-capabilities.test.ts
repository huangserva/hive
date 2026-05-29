import { describe, expect, test } from 'vitest'

import {
  getCommandPresetCapabilities,
  serializeCommandPresetCapabilities,
  summarizeCommandPresetCapabilities,
} from '../../src/server/command-preset-capabilities.js'

describe('command preset capability manifest', () => {
  test('derives Codex browser and MCP features from the builtin Playwright preset args', () => {
    const manifest = getCommandPresetCapabilities('codex')

    expect(manifest).toMatchObject({
      mode: 'cli_agent',
      providerFamily: 'codex',
      riskTier: 'high',
      unattended: true,
    })
    expect(manifest.features).toEqual(
      expect.arrayContaining(['browser_e2e', 'mcp', 'session_capture', 'session_resume'])
    )
  })

  test('marks unknown presets without inventing unsupported features', () => {
    expect(getCommandPresetCapabilities('custom-shell')).toEqual({
      features: [],
      mode: 'unknown',
      providerFamily: 'custom',
      riskTier: 'unknown',
      unattended: 'unknown',
    })
  })

  test('serializes to snake_case and produces a compact orchestrator summary', () => {
    const serialized = serializeCommandPresetCapabilities(getCommandPresetCapabilities('opencode'))
    expect(serialized).toMatchObject({
      provider_family: 'opencode',
      risk_tier: 'unknown',
      unattended: 'unknown',
    })
    expect(serialized.features).toContain('terminal_input_profile')

    const summary = summarizeCommandPresetCapabilities(
      'OpenCode',
      getCommandPresetCapabilities('opencode')
    )
    expect(summary).toContain('OpenCode')
    expect(summary).toContain('provider=opencode')
    expect(summary).toContain('terminal_input_profile')
  })
})
