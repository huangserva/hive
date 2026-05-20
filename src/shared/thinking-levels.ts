export interface ThinkingLevelOption {
  label: string
  value: string
}

export const THINKING_LEVELS_BY_PRESET_ID: Record<string, ThinkingLevelOption[]> = {
  claude: [
    { label: 'Low', value: 'low' },
    { label: 'Medium', value: 'medium' },
    { label: 'High', value: 'high' },
    { label: 'Extra high', value: 'xhigh' },
    { label: 'Max', value: 'max' },
  ],
  codex: [
    { label: 'None', value: 'none' },
    { label: 'Minimal', value: 'minimal' },
    { label: 'Low', value: 'low' },
    { label: 'Medium', value: 'medium' },
    { label: 'High', value: 'high' },
    { label: 'Extra high', value: 'xhigh' },
  ],
}

export const getThinkingLevelsForPreset = (
  presetId: string | null | undefined
): ThinkingLevelOption[] => (presetId ? (THINKING_LEVELS_BY_PRESET_ID[presetId] ?? []) : [])

export const isThinkingLevelSupported = (
  presetId: string | null | undefined,
  level: string | null | undefined
) => {
  if (!level) return false
  return getThinkingLevelsForPreset(presetId).some((option) => option.value === level)
}
