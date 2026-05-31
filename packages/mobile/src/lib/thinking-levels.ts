import type { MobileCommandPresetThinkingLevel } from '../api/client'

export interface ThinkingLevelOption {
  label: string
  value: string
}

export const toThinkingLevelOptions = (
  levels: MobileCommandPresetThinkingLevel[] | null | undefined
): ThinkingLevelOption[] =>
  (levels ?? [])
    .map(({ label, value }) => {
      const trimmedValue = value.trim()
      return {
        label: label.trim() || trimmedValue,
        value: trimmedValue,
      }
    })
    .filter((level) => level.value.length > 0)
