import { getThinkingLevelsForPreset } from '../shared/thinking-levels.js'
import type {
  CommandPresetCapabilities,
  CommandPresetCapabilitiesPayload,
  CommandPresetFeature,
  CommandPresetProviderFamily,
  CommandPresetRiskTier,
  CommandPresetUnattended,
} from '../shared/types.js'
import { getBuiltinCommandPreset } from './command-preset-defaults.js'

const BUILTIN_PROVIDER_FAMILIES = new Set(['claude', 'codex', 'opencode', 'gemini'])

const toProviderFamily = (presetId: string): CommandPresetProviderFamily =>
  BUILTIN_PROVIDER_FAMILIES.has(presetId) ? (presetId as CommandPresetProviderFamily) : 'custom'

const hasPlaywrightMcp = (args: string[]) =>
  args.some((arg) => arg.includes('mcp_servers.playwright'))

const inferRiskTier = (args: string[] | null): CommandPresetRiskTier => {
  if (!args) return 'unknown'
  if (
    args.some(
      (arg) =>
        arg.includes('dangerously') ||
        arg.includes('bypassPermissions') ||
        arg === '--yolo' ||
        arg === '--permission-mode=bypassPermissions'
    )
  ) {
    return 'high'
  }
  return args.length > 0 ? 'moderate' : 'unknown'
}

const inferUnattended = (args: string[] | null): CommandPresetUnattended => {
  if (!args) return 'unknown'
  return args.length > 0 ? true : 'unknown'
}

const uniq = <T>(items: T[]) => [...new Set(items)]

export const getCommandPresetCapabilities = (presetId: string): CommandPresetCapabilities => {
  const preset = getBuiltinCommandPreset(presetId)
  const providerFamily = toProviderFamily(presetId)
  if (!preset) {
    return {
      features: [],
      mode: 'unknown',
      providerFamily,
      riskTier: 'unknown',
      unattended: 'unknown',
    }
  }

  const yoloArgs = preset.yoloArgsTemplate ?? []
  const features: CommandPresetFeature[] = []
  if (preset.resumeArgsTemplate) features.push('session_resume')
  if (preset.sessionIdCapture) features.push('session_capture')
  if (getThinkingLevelsForPreset(preset.id).length > 0) features.push('thinking_levels')
  if (hasPlaywrightMcp(yoloArgs)) {
    features.push('browser_e2e', 'mcp')
  }
  if (preset.id === 'opencode') features.push('terminal_input_profile')

  return {
    features: uniq(features),
    mode: 'cli_agent',
    providerFamily,
    riskTier: inferRiskTier(preset.yoloArgsTemplate),
    unattended: inferUnattended(preset.yoloArgsTemplate),
  }
}

export const serializeCommandPresetCapabilities = (
  capabilities: CommandPresetCapabilities
): CommandPresetCapabilitiesPayload => ({
  features: capabilities.features,
  mode: capabilities.mode,
  provider_family: capabilities.providerFamily,
  risk_tier: capabilities.riskTier,
  unattended: capabilities.unattended,
})

export const summarizeCommandPresetCapabilities = (
  displayName: string,
  capabilities: CommandPresetCapabilities
) => {
  const features = capabilities.features.length ? capabilities.features.join(', ') : 'unknown'
  return `${displayName} capabilities: provider=${capabilities.providerFamily}; mode=${capabilities.mode}; risk=${capabilities.riskTier}; unattended=${capabilities.unattended}; features=${features}`
}

export const getSerializedCommandPresetCapabilities = (presetId: string) =>
  serializeCommandPresetCapabilities(getCommandPresetCapabilities(presetId))
