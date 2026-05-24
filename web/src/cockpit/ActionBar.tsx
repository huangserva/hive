import { Sparkles } from 'lucide-react'

import type { AIAction } from '../api.js'

const priorityLabel = (priority: AIAction['priority']) => {
  if (priority === 'high') return '高'
  if (priority === 'medium') return '中'
  return '低'
}

const priorityColor = (priority: AIAction['priority']) => {
  if (priority === 'high') return 'var(--status-red)'
  if (priority === 'medium') return 'var(--status-yellow)'
  return 'var(--text-tertiary)'
}

export const ActionBar = ({ actions }: { actions: AIAction[] }) => (
  <footer
    className="shrink-0 border-t px-4 py-3"
    style={{ background: 'var(--bg-0)', borderColor: 'var(--border)' }}
  >
    <div className="mb-2 flex items-center gap-2 font-medium text-pri text-xs">
      <Sparkles size={14} className="text-accent" />
      <span>AI 准备好的待办行动</span>
      <span className="text-ter tabular-nums">({actions.length})</span>
    </div>
    {actions.length ? (
      <div className="space-y-1.5">
        {actions.slice(0, 10).map((action) => (
          <div
            className="flex min-h-8 items-center gap-2 rounded border px-2 py-1.5 text-xs"
            key={`${action.type}:${action.id}`}
            style={{ borderColor: 'var(--border)', background: 'var(--bg-1)' }}
          >
            <span
              className="shrink-0 rounded border px-1.5 py-0.5 font-medium"
              style={{
                borderColor: 'color-mix(in oklab, currentColor 35%, transparent)',
                color: priorityColor(action.priority),
              }}
            >
              {priorityLabel(action.priority)}
            </span>
            <span className="min-w-0 flex-1 truncate text-sec">{action.text}</span>
            <button
              className="shrink-0 cursor-pointer rounded px-2 py-1 text-accent hover:bg-3"
              type="button"
              onClick={() => {
                // TODO: wire POST actions in Phase C-2.5.
              }}
            >
              {action.action}
            </button>
          </div>
        ))}
      </div>
    ) : (
      <div
        className="rounded border px-3 py-2 text-sec text-xs"
        style={{ borderColor: 'var(--border)' }}
      >
        当前没有 AI 等待 user 处理的行动。
      </div>
    )}
  </footer>
)
