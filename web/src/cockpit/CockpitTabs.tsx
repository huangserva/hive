import {
  Archive,
  BookOpen,
  CheckSquare,
  CircleHelp,
  FileText,
  GitBranch,
  Lightbulb,
  Map as MapIcon,
} from 'lucide-react'

import type { ParsedCockpit } from '../api.js'

export type CockpitTab =
  | 'plan'
  | 'tasks'
  | 'questions'
  | 'ideas'
  | 'decisions'
  | 'research'
  | 'baseline'
  | 'archive'

const TABS: Array<{
  icon: typeof MapIcon
  id: CockpitTab
  label: string
}> = [
  { icon: MapIcon, id: 'plan', label: 'Plan' },
  { icon: CheckSquare, id: 'tasks', label: 'Tasks' },
  { icon: CircleHelp, id: 'questions', label: 'Questions' },
  { icon: Lightbulb, id: 'ideas', label: 'Ideas' },
  { icon: GitBranch, id: 'decisions', label: 'Decisions' },
  { icon: BookOpen, id: 'research', label: 'Research' },
  { icon: FileText, id: 'baseline', label: 'Baseline' },
  { icon: Archive, id: 'archive', label: 'Archive' },
]

const tabBadge = (cockpit: ParsedCockpit | null, tab: CockpitTab) => {
  if (!cockpit) return null
  if (tab === 'tasks') return (cockpit.tasks?.totalOpen ?? 0) + (cockpit.tasks?.totalDone ?? 0)
  if (tab === 'questions') return cockpit.questions.high.length + cockpit.questions.medium.length
  if (tab === 'ideas') return cockpit.ideas.inbox.length
  if (tab === 'decisions') return cockpit.decisions.drafts.length + cockpit.decisions.adopted.length
  if (tab === 'research') return cockpit.research?.totalCount ?? 0
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

export const CockpitTabs = ({ activeTab, cockpit, onChange }: CockpitTabsProps) => (
  <nav
    className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2"
    style={{ borderColor: 'var(--border)' }}
  >
    {TABS.map(({ icon: Icon, id, label }) => {
      const badge = tabBadge(cockpit, id)
      const active = activeTab === id
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
          <span>{label}</span>
          {badge ? (
            <span
              className="rounded-full border px-1.5 text-[10px] tabular-nums"
              style={{
                borderColor: 'color-mix(in oklab, currentColor 35%, transparent)',
                color: badgeStyle(id, badge),
              }}
            >
              {badge}
            </span>
          ) : null}
        </button>
      )
    })}
  </nav>
)
