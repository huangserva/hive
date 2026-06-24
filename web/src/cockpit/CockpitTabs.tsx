import {
  Archive,
  BookOpen,
  CheckSquare,
  CircleHelp,
  ClipboardList,
  FileText,
  GitBranch,
  History,
  Lightbulb,
  Map as MapIcon,
  Wrench,
} from 'lucide-react'

import type { ParsedCockpit } from '../api.js'
import { type TranslationKey, useI18n } from '../i18n.js'

export type CockpitTab =
  | 'plan'
  | 'tasks'
  | 'questions'
  | 'ideas'
  | 'decisions'
  | 'research'
  | 'reports'
  | 'timeline'
  | 'baseline'
  | 'archive'
  | 'setup'

const TABS: Array<{
  icon: typeof MapIcon
  id: CockpitTab
  labelKey: TranslationKey
}> = [
  { icon: MapIcon, id: 'plan', labelKey: 'cockpit.tabs.plan' },
  { icon: CheckSquare, id: 'tasks', labelKey: 'cockpit.tabs.tasks' },
  { icon: CircleHelp, id: 'questions', labelKey: 'cockpit.tabs.questions' },
  { icon: Lightbulb, id: 'ideas', labelKey: 'cockpit.tabs.ideas' },
  { icon: GitBranch, id: 'decisions', labelKey: 'cockpit.tabs.decisions' },
  { icon: BookOpen, id: 'research', labelKey: 'cockpit.tabs.research' },
  { icon: ClipboardList, id: 'reports', labelKey: 'cockpit.tabs.reports' },
  { icon: History, id: 'timeline', labelKey: 'cockpit.tabs.timeline' },
  { icon: FileText, id: 'baseline', labelKey: 'cockpit.tabs.baseline' },
  { icon: Archive, id: 'archive', labelKey: 'cockpit.tabs.archive' },
  { icon: Wrench, id: 'setup', labelKey: 'cockpit.tabs.setup' },
]

const tabBadge = (cockpit: ParsedCockpit | null, tab: CockpitTab) => {
  if (!cockpit) return null
  if (tab === 'tasks') return (cockpit.tasks?.totalOpen ?? 0) + (cockpit.tasks?.totalDone ?? 0)
  if (tab === 'questions') return cockpit.questions.high.length + cockpit.questions.medium.length
  if (tab === 'ideas') return cockpit.ideas.inbox.length
  if (tab === 'decisions') return cockpit.decisions.drafts.length + cockpit.decisions.adopted.length
  if (tab === 'research') return cockpit.research?.totalCount ?? 0
  if (tab === 'reports') return cockpit.reports?.totalCount ?? 0
  if (tab === 'baseline') return cockpit.baseline.staleHint ? 'stale' : null
  if (tab === 'archive') return cockpit.archive.months.length
  return null
}

const badgeStyle = (tab: CockpitTab, value: number | string) => {
  if (tab === 'questions' && Number(value) > 0) return 'var(--status-red)'
  if (tab === 'baseline' && value === 'stale') return 'var(--status-yellow)'
  return 'var(--text-tertiary)'
}

type CockpitTabsProps = {
  activeTab: CockpitTab
  cockpit: ParsedCockpit | null
  onChange: (tab: CockpitTab) => void
}

export const CockpitTabs = ({ activeTab, cockpit, onChange }: CockpitTabsProps) => {
  const { t } = useI18n()
  return (
    <nav
      className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2"
      style={{ borderColor: 'var(--border)' }}
    >
      {TABS.map(({ icon: Icon, id, labelKey }) => {
        const badge = tabBadge(cockpit, id)
        const active = activeTab === id
        const badgeLabel = badge === 'stale' ? t('cockpit.tabs.stale') : badge
        return (
          <button
            aria-pressed={active}
            className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded px-2.5 text-xs text-sec hover:bg-3 hover:text-pri"
            key={id}
            onClick={() => onChange(id)}
            style={active ? { background: 'var(--bg-3)', color: 'var(--text-primary)' } : undefined}
            type="button"
          >
            <Icon size={14} />
            <span>{t(labelKey)}</span>
            {badge ? (
              <span
                className="rounded-full border px-1.5 text-[10px] tabular-nums"
                style={{
                  borderColor: 'color-mix(in oklab, currentColor 35%, transparent)',
                  color: badgeStyle(id, badge),
                }}
              >
                {badgeLabel}
              </span>
            ) : null}
          </button>
        )
      })}
    </nav>
  )
}
