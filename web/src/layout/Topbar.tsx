import { ListChecks, Map as MapIcon } from 'lucide-react'

import type { VersionInfo } from '../api.js'
import { FeishuStatusIndicator } from '../feishu/FeishuStatusIndicator.js'
import { useI18n } from '../i18n.js'
import { NotificationSettingsButton } from '../notifications/NotificationSettingsButton.js'
import { Tooltip } from '../ui/Tooltip.js'
import { APP_VERSION } from '../version.js'
import { HippoLogo } from './HippoLogo.js'
import { LanguageToggle } from './LanguageToggle.js'

type TopbarProps = {
  hideActions?: boolean
  onTogglePlan: () => void
  onToggleTaskGraph: () => void
  openTaskCount?: number
  planOpen: boolean
  taskGraphOpen: boolean
  version?: string
  versionInfo?: VersionInfo
}

export const Topbar = ({
  hideActions = false,
  onTogglePlan,
  onToggleTaskGraph,
  openTaskCount = 0,
  planOpen,
  taskGraphOpen,
  version = APP_VERSION,
}: TopbarProps) => {
  const { t } = useI18n()
  const hasOpenTasks = openTaskCount > 0
  const tooltipLabel = taskGraphOpen
    ? t('topbar.hideTodo')
    : hasOpenTasks
      ? t('topbar.todoOpen', { count: openTaskCount })
      : t('topbar.showTodo')
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
          <Tooltip label={planOpen ? 'Hide Plan' : 'Show Plan (.hive/plan.md)'}>
            <button
              type="button"
              onClick={onTogglePlan}
              aria-pressed={planOpen}
              aria-label="Toggle Plan"
              className="flex cursor-pointer items-center gap-1.5 rounded px-3 py-1 text-xs text-sec hover:bg-3 hover:text-pri"
              data-testid="topbar-plan"
            >
              <MapIcon size={14} aria-hidden className={planOpen ? 'text-accent' : undefined} />
              <span>Plan</span>
            </button>
          </Tooltip>
          <Tooltip label={tooltipLabel}>
            <button
              type="button"
              onClick={onToggleTaskGraph}
              aria-pressed={taskGraphOpen}
              aria-label="Toggle Todo"
              data-has-tasks={hasOpenTasks ? 'true' : undefined}
              className="flex cursor-pointer items-center gap-1.5 rounded px-3 py-1 text-xs text-sec hover:bg-3 hover:text-pri"
              data-testid="topbar-blueprint"
            >
              <ListChecks
                size={14}
                aria-hidden
                /* Light up when there are open tasks so the icon reads as
                   "you have something to look at" without a separate
                   badge. text-accent on a dim button is enough; bumping
                   the surrounding text would be too loud. */
                className={hasOpenTasks ? 'text-accent' : undefined}
              />
              <span>{t('topbar.todo')}</span>
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
