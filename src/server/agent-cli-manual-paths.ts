import type { AgentLaunchConfigInput } from './agent-run-store.js'
import type { SettingsStore } from './settings-store.js'

const APP_STATE_KEY = 'agent_cli_manual_paths'

const parseManualCliPaths = (value: string | null | undefined): Record<string, string> => {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === 'string' &&
          entry[0].trim().length > 0 &&
          typeof entry[1] === 'string' &&
          entry[1].trim().length > 0
      )
    )
  } catch {
    return {}
  }
}

export const getManualCliPaths = (settings: SettingsStore): Record<string, string> =>
  parseManualCliPaths(settings.getAppState(APP_STATE_KEY)?.value)

export const getManualCliPath = (settings: SettingsStore, presetId: string): string | null =>
  getManualCliPaths(settings)[presetId] ?? null

export const setManualCliPath = (
  settings: SettingsStore,
  presetId: string,
  commandPath: string
): void => {
  settings.setAppState(
    APP_STATE_KEY,
    JSON.stringify({
      ...getManualCliPaths(settings),
      [presetId]: commandPath,
    })
  )
}

export const applyManualCliPathToLaunchConfig = (
  settings: SettingsStore,
  config: AgentLaunchConfigInput | undefined
): AgentLaunchConfigInput | undefined => {
  if (!config?.commandPresetId) return config
  const manualPath = getManualCliPath(settings, config.commandPresetId)
  return manualPath ? { ...config, command: manualPath } : config
}
