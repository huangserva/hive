import { Gauge } from 'lucide-react'

import type { VersionInfo } from '../api.js'
import { FeishuStatusIndicator } from '../feishu/FeishuStatusIndicator.js'
import { useI18n } from '../i18n.js'
import { NotificationSettingsButton } from '../notifications/NotificationSettingsButton.js'
import { Tooltip } from '../ui/Tooltip.js'
import { APP_VERSION } from '../version.js'
import { HippoLogo } from './HippoLogo.js'
import { LanguageToggle } from './LanguageToggle.js'

type TopbarProps = {
  cockpitActionCount?: number
  cockpitOpen: boolean
  hideActions?: boolean
  onToggleCockpit: () => void
  version?: string
  versionInfo?: VersionInfo
}

export const Topbar = ({
  cockpitActionCount = 0,
  cockpitOpen,
  hideActions = false,
  onToggleCockpit,
  version = APP_VERSION,
}: TopbarProps) => {
  const { t } = useI18n()
  return (
    <header
      className="flex h-11 shrink-0 items-center px-4"
      style={{
        background: 'var(--bg-0)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div className="flex items-center gap-2">
        <HippoLogo size={16} className="text-pri" />
        <span className="font-semibold text-pri">HippoTeam</span>
        <span className="text-ter text-xs tabular-nums">v{version}</span>
      </div>
      <div className="flex-1" />
      {hideActions ? null : (
        <div className="flex items-center gap-1">
          <Tooltip label={cockpitOpen ? t('topbar.hideCockpit') : t('topbar.showCockpit')}>
            <button
              type="button"
              onClick={onToggleCockpit}
              aria-pressed={cockpitOpen}
              aria-label={t('topbar.toggleCockpit')}
              className="relative flex cursor-pointer items-center gap-1.5 rounded px-3 py-1 text-xs text-sec hover:bg-3 hover:text-pri"
              data-testid="topbar-cockpit"
            >
              <Gauge
                size={14}
                aria-hidden
                className={cockpitOpen || cockpitActionCount > 0 ? 'text-accent' : undefined}
              />
              <span>{t('topbar.cockpit')}</span>
              {cockpitActionCount > 0 ? (
                <span
                  className="-top-1 -right-1 absolute min-w-4 rounded-full px-1 text-center text-[10px] text-white tabular-nums"
                  style={{ background: 'var(--status-red)' }}
                >
                  {cockpitActionCount}
                </span>
              ) : null}
            </button>
          </Tooltip>
          <FeishuStatusIndicator />
          <LanguageToggle />
          <NotificationSettingsButton />
        </div>
      )}
    </header>
  )
}
