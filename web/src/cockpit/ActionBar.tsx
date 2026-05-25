import { Sparkles } from 'lucide-react'

import type { AIAction } from '../api.js'
import { useI18n } from '../i18n.js'

const priorityColor = (priority: AIAction['priority']) => {
  if (priority === 'high') return 'var(--status-red)'
  if (priority === 'medium') return 'var(--status-yellow)'
  return 'var(--text-tertiary)'
}

const actionLabelKey = (action: AIAction['action']) => {
  if (action === '回答') return 'cockpit.actionBar.action.answer'
  if (action === '查看') return 'cockpit.actionBar.action.view'
  if (action === '确认') return 'cockpit.actionBar.action.confirm'
  return null
}

const priorityLabelKey = (priority: AIAction['priority']) => {
  if (priority === 'high') return 'cockpit.actionBar.priority.high'
  if (priority === 'medium') return 'cockpit.actionBar.priority.medium'
  return 'cockpit.actionBar.priority.low'
}

const legacyPriorityLabel = (priority: AIAction['priority']) => {
  if (priority === 'high') return '\u9ad8'
  if (priority === 'medium') return '\u4e2d'
  return '\u4f4e'
}

const hasLocalizedActionLabels = (actions: AIAction[]) =>
  actions.some((action) => /[\u4e00-\u9fff]/u.test(action.action))

const LEGACY_EMPTY_MESSAGE =
  '\u5f53\u524d\u6ca1\u6709 AI \u7b49\u5f85 user \u5904\u7406\u7684\u884c\u52a8\u3002'

export const ActionBar = ({
  actions,
  onAction,
}: {
  actions: AIAction[]
  onAction?: (action: AIAction) => void
}) => {
  const { isFallback, t } = useI18n()
  const useLegacyLabels = isFallback && hasLocalizedActionLabels(actions)
  return (
    <footer
      className="shrink-0 border-t px-4 py-3"
      style={{ background: 'var(--bg-0)', borderColor: 'var(--border)' }}
    >
      <div className="mb-2 flex items-center gap-2 font-medium text-pri text-xs">
        <Sparkles size={14} className="text-accent" />
        <span>{t('cockpit.actionBar.title')}</span>
        <span className="text-ter tabular-nums">({actions.length})</span>
      </div>
      {actions.length ? (
        <div className="space-y-1.5">
          {actions.slice(0, 10).map((action) => {
            const labelKey = actionLabelKey(action.action)
            return (
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
                  {useLegacyLabels
                    ? legacyPriorityLabel(action.priority)
                    : t(priorityLabelKey(action.priority))}
                </span>
                <span className="min-w-0 flex-1 truncate text-sec">{action.text}</span>
                <button
                  className="shrink-0 cursor-pointer rounded px-2 py-1 text-accent hover:bg-3"
                  type="button"
                  onClick={() => onAction?.(action)}
                >
                  {useLegacyLabels ? action.action : labelKey ? t(labelKey) : action.action}
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <div
          className="rounded border px-3 py-2 text-sec text-xs"
          style={{ borderColor: 'var(--border)' }}
        >
          {isFallback ? LEGACY_EMPTY_MESSAGE : t('cockpit.actionBar.empty')}
        </div>
      )}
    </footer>
  )
}
