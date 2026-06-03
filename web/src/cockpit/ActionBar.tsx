import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react'
import { useCallback, useState } from 'react'

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
  if (action === '补 note') return 'cockpit.actionBar.action.addNote'
  if (action === '准备') return 'cockpit.actionBar.action.prepare'
  if (action === '开实施') return 'cockpit.actionBar.action.startImpl'
  if (action === '派 reviewer') return 'cockpit.actionBar.action.assignReviewer'
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
const ACTION_BAR_COLLAPSED_STORAGE_KEY = 'hive.cockpit.actionBar.collapsed'

const readInitialCollapsed = () => {
  try {
    return window.localStorage.getItem(ACTION_BAR_COLLAPSED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export const ActionBar = ({
  actions,
  onAction,
}: {
  actions: AIAction[]
  onAction?: (action: AIAction) => void
}) => {
  const { isFallback, t } = useI18n()
  const [collapsed, setCollapsed] = useState(readInitialCollapsed)
  const useLegacyLabels = isFallback && hasLocalizedActionLabels(actions)
  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current
      try {
        window.localStorage.setItem(ACTION_BAR_COLLAPSED_STORAGE_KEY, next ? '1' : '0')
      } catch {
        // localStorage can be unavailable; keep this as in-memory UI state.
      }
      return next
    })
  }, [])
  return (
    <footer
      className="shrink-0 border-t px-4 py-3"
      style={{ background: 'var(--bg-0)', borderColor: 'var(--border)' }}
    >
      <button
        aria-expanded={!collapsed}
        className={`flex w-full cursor-pointer items-center gap-2 rounded text-left font-medium text-pri text-xs hover:bg-2 ${collapsed ? '' : 'mb-2'}`}
        type="button"
        onClick={toggleCollapsed}
      >
        <Sparkles size={14} className="text-accent" />
        <span>{t('cockpit.actionBar.title')}</span>
        <span className="text-ter tabular-nums">({actions.length})</span>
        <span className="flex-1" />
        {collapsed ? (
          <ChevronRight size={14} className="text-ter" />
        ) : (
          <ChevronDown size={14} className="text-ter" />
        )}
      </button>
      {!collapsed && actions.length ? (
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
      ) : !collapsed ? (
        <div
          className="rounded border px-3 py-2 text-sec text-xs"
          style={{ borderColor: 'var(--border)' }}
        >
          {isFallback ? LEGACY_EMPTY_MESSAGE : t('cockpit.actionBar.empty')}
        </div>
      ) : null}
    </footer>
  )
}
