import { Download, Loader2 } from 'lucide-react'

import { useI18n } from '../i18n.js'
import { Tooltip } from '../ui/Tooltip.js'
import { useDisplayMode } from './use-display-mode.js'
import { useInstallPrompt } from './use-install-prompt.js'

/**
 * Topbar entry point for the browser's PWA install prompt. Renders nothing
 * when the app is already running standalone (any non-`browser` display mode)
 * or when no `beforeinstallprompt` event has been cached yet — the former
 * covers installed-and-launched-as-PWA, the latter covers browsers that don't
 * support PWA install (Firefox / Safari).
 */
export const InstallAppButton = () => {
  const { t } = useI18n()
  const displayMode = useDisplayMode()
  const { available, prompt, prompting } = useInstallPrompt()

  if (displayMode !== 'browser') return null
  if (!available) return null

  const port = typeof window !== 'undefined' ? window.location.port || '80' : ''
  // Switch the accessible label while the native prompt is open so screen
  // reader users hear the in-flight state, not the idle label.
  const label = prompting ? t('pwa.installing') : t('pwa.installAsApp')
  const tooltip = t('pwa.installAsAppTooltip', { port })

  return (
    <Tooltip label={tooltip}>
      <button
        type="button"
        aria-label={label}
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-sec hover:bg-3 hover:text-pri disabled:cursor-default disabled:opacity-60"
        data-testid="topbar-install"
        disabled={prompting}
        onClick={() => {
          void prompt()
        }}
      >
        {prompting ? (
          <Loader2 size={14} className="animate-spin" aria-hidden />
        ) : (
          <Download size={14} aria-hidden />
        )}
      </button>
    </Tooltip>
  )
}
