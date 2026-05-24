import { CheckCircle2, ChevronDown, ChevronRight, Circle } from 'lucide-react'
import { useState } from 'react'

import type { ParsedMilestone, PlanMilestoneStatus } from '../api.js'

const STATUS_TONE: Record<PlanMilestoneStatus, string> = {
  blocked: 'var(--status-red)',
  in_progress: 'var(--accent)',
  open: 'var(--text-tertiary)',
  proposed: '#9b6cff',
  shipped: 'var(--status-green)',
}

export const MilestoneCard = ({ milestone }: { milestone: ParsedMilestone }) => {
  const [expanded, setExpanded] = useState(false)
  const percent = Math.round(milestone.progress * 100)
  const tone = STATUS_TONE[milestone.status]
  return (
    <article className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full cursor-pointer items-start gap-3 text-left"
      >
        <span className="mt-0.5 text-ter">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-semibold text-pri text-sm">{milestone.id}</span>
            <span className="min-w-0 flex-1 truncate text-sec text-sm">{milestone.title}</span>
            {milestone.date ? (
              <span className="shrink-0 text-ter text-xs tabular-nums">{milestone.date}</span>
            ) : null}
          </span>
          <span className="mt-2 flex items-center gap-2">
            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-3">
              <span
                className="block h-full rounded-full"
                style={{ background: tone, width: `${percent}%` }}
              />
            </span>
            <span className="shrink-0 text-ter text-xs tabular-nums">
              {milestone.doneCount}/{milestone.totalCount}
            </span>
          </span>
        </span>
      </button>
      {expanded ? (
        milestone.items.length ? (
          <ul className="mt-3 space-y-1.5 pl-7 text-sm">
            {milestone.items.map((item) => {
              const Icon = item.done ? CheckCircle2 : Circle
              return (
                <li className="flex gap-2 text-sec" key={`${item.done}:${item.text}`}>
                  <Icon size={14} className={item.done ? 'text-accent' : 'text-ter'} aria-hidden />
                  <span className={item.done ? 'text-ter line-through' : undefined}>
                    {item.text}
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <pre className="mt-3 overflow-auto rounded bg-2 p-3 text-ter text-xs leading-5">
            {milestone.body || '(empty)'}
          </pre>
        )
      ) : null}
    </article>
  )
}
