import {
  getDefaultOpenTargetIdForPlatform,
  isOpenTargetId,
  isOpenTargetSupported,
  OPEN_TARGET_IDS_BY_PLATFORM,
  type OpenTargetId,
  type OpenTargetPlatform,
} from '../../../src/shared/open-targets.js'
import cursorIcon from '../assets/open-targets/cursor.svg'
import finderIcon from '../assets/open-targets/finder.svg'
import ghosttyIcon from '../assets/open-targets/ghostty.svg'
import intellijIcon from '../assets/open-targets/intellijidea.svg'
import iterm2Icon from '../assets/open-targets/iterm2.svg'
import terminalIcon from '../assets/open-targets/terminal.svg'
import vscodeIcon from '../assets/open-targets/vscode.svg'
import windsurfIcon from '../assets/open-targets/windsurf.svg'
import zedIcon from '../assets/open-targets/zed.svg'

export type { OpenTargetId, OpenTargetPlatform }
export { getDefaultOpenTargetIdForPlatform, isOpenTargetSupported, OPEN_TARGET_IDS_BY_PLATFORM }

export interface OpenTargetOption {
  id: OpenTargetId
  /**
   * i18n key for the display label. Translation lives in `i18n.tsx` so that
   * "Finder" → "File Explorer" / "File Manager" stays consistent with the UI
   * language toggle rather than being keyed off the OS platform.
   */
  labelKey:
    | 'openWorkspace.target.vscode'
    | 'openWorkspace.target.vscodeInsiders'
    | 'openWorkspace.target.cursor'
    | 'openWorkspace.target.windsurf'
    | 'openWorkspace.target.finder.mac'
    | 'openWorkspace.target.finder.windows'
    | 'openWorkspace.target.finder.linux'
    | 'openWorkspace.target.terminal'
    | 'openWorkspace.target.iterm2'
    | 'openWorkspace.target.ghostty'
    | 'openWorkspace.target.intellijidea'
    | 'openWorkspace.target.zed'
  iconSrc: string
}

const FINDER_LABEL_KEY_BY_PLATFORM: Record<OpenTargetPlatform, OpenTargetOption['labelKey']> = {
  mac: 'openWorkspace.target.finder.mac',
  windows: 'openWorkspace.target.finder.windows',
  linux: 'openWorkspace.target.finder.linux',
  other: 'openWorkspace.target.finder.linux',
}

const TARGET_DATA: Record<OpenTargetId, Omit<OpenTargetOption, 'id'>> = {
  vscode: { labelKey: 'openWorkspace.target.vscode', iconSrc: vscodeIcon },
  'vscode-insiders': { labelKey: 'openWorkspace.target.vscodeInsiders', iconSrc: vscodeIcon },
  cursor: { labelKey: 'openWorkspace.target.cursor', iconSrc: cursorIcon },
  windsurf: { labelKey: 'openWorkspace.target.windsurf', iconSrc: windsurfIcon },
  // The actual labelKey is resolved per platform in getOpenTargetOption.
  finder: { labelKey: 'openWorkspace.target.finder.mac', iconSrc: finderIcon },
  terminal: { labelKey: 'openWorkspace.target.terminal', iconSrc: terminalIcon },
  iterm2: { labelKey: 'openWorkspace.target.iterm2', iconSrc: iterm2Icon },
  ghostty: { labelKey: 'openWorkspace.target.ghostty', iconSrc: ghosttyIcon },
  intellijidea: { labelKey: 'openWorkspace.target.intellijidea', iconSrc: intellijIcon },
  zed: { labelKey: 'openWorkspace.target.zed', iconSrc: zedIcon },
}

const resolveLabelKey = (
  targetId: OpenTargetId,
  platform: OpenTargetPlatform
): OpenTargetOption['labelKey'] =>
  targetId === 'finder' ? FINDER_LABEL_KEY_BY_PLATFORM[platform] : TARGET_DATA[targetId].labelKey

export const getOpenTargetOption = (
  targetId: OpenTargetId,
  platform: OpenTargetPlatform
): OpenTargetOption => {
  const supportedId = isOpenTargetSupported(targetId, platform)
    ? targetId
    : getDefaultOpenTargetIdForPlatform(platform)
  return {
    id: supportedId,
    iconSrc: TARGET_DATA[supportedId].iconSrc,
    labelKey: resolveLabelKey(supportedId, platform),
  }
}

export const getOpenTargetOptions = (platform: OpenTargetPlatform): readonly OpenTargetOption[] =>
  OPEN_TARGET_IDS_BY_PLATFORM[platform].map((targetId) => ({
    id: targetId,
    iconSrc: TARGET_DATA[targetId].iconSrc,
    labelKey: resolveLabelKey(targetId, platform),
  }))

/**
 * Browser-side platform detection. Server already validates the requested
 * target against its own platform, so a misdetection here at worst shows an
 * impossible option in the dropdown — the server falls back gracefully.
 */
export const resolveOpenTargetPlatform = (): OpenTargetPlatform => {
  if (typeof navigator === 'undefined') return 'other'
  const source = `${navigator.userAgent} ${navigator.platform}`.toLowerCase()
  if (source.includes('mac') || source.includes('darwin')) return 'mac'
  if (source.includes('win')) return 'windows'
  if (source.includes('linux') || source.includes('x11')) return 'linux'
  return 'other'
}

export const PREFERRED_OPEN_TARGET_STORAGE_KEY = 'hive.openTarget.preferred'

const readPreferredOpenTargetRaw = (): string | null => {
  try {
    return window.localStorage.getItem(PREFERRED_OPEN_TARGET_STORAGE_KEY)
  } catch {
    return null
  }
}

export const loadPersistedOpenTargetId = (platform: OpenTargetPlatform): OpenTargetId => {
  const fallback = getDefaultOpenTargetIdForPlatform(platform)
  if (typeof window === 'undefined') return fallback
  const raw = readPreferredOpenTargetRaw()
  if (!raw) return fallback
  // Tolerate historical typos that shipped in the kanban port we forked from.
  const normalized = raw === 'ghostie' ? 'ghostty' : raw === 'intellij_idea' ? 'intellijidea' : raw
  if (isOpenTargetId(normalized) && isOpenTargetSupported(normalized, platform)) {
    return normalized
  }
  return fallback
}

export const persistOpenTargetId = (targetId: OpenTargetId): void => {
  try {
    window.localStorage.setItem(PREFERRED_OPEN_TARGET_STORAGE_KEY, targetId)
  } catch {
    // Quota exceeded / private browsing — fall back to in-memory selection.
  }
}
