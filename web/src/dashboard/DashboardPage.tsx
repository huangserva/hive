import { LayoutDashboard } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { type DashboardWorkspace, fetchDashboard } from '../api.js'
import { useI18n } from '../i18n.js'
import { EmptyState } from '../ui/EmptyState.js'

type DashboardPageProps = {
  onSelectWorkspace: (workspaceId: string) => void
}

const formatRelativeTime = (timestamp: number | null): string => {
  if (!timestamp) return '—'
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export const DashboardPage = ({ onSelectWorkspace }: DashboardPageProps) => {
  const { t } = useI18n()
  const [workspaces, setWorkspaces] = useState<DashboardWorkspace[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchDashboard()
      .then(setWorkspaces)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      {error ? (
        <p className="text-sm text-status-red">{error}</p>
      ) : workspaces === null ? (
        <p className="text-sm text-ter">{t('common.loading')}</p>
      ) : workspaces.length === 0 ? (
        <EmptyState title={t('dashboard.noWorkspaces')} icon={<LayoutDashboard size={20} />} />
      ) : (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
        >
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              type="button"
              onClick={() => onSelectWorkspace(ws.id)}
              data-testid="dashboard-card"
              className="flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors hover:bg-3"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-2)' }}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-pri">{ws.name}</span>
              </div>
              <span className="mono truncate text-xs text-ter">{ws.cwd}</span>
              <div className="mt-1 flex flex-wrap gap-3 text-xs text-sec">
                <span>
                  {t('dashboard.workers')}: {ws.activeWorkerCount}/{ws.workerCount}
                </span>
                <span>
                  {t('dashboard.dispatches24h')}: {ws.recentDispatchCount}
                </span>
                {ws.openDispatchCount > 0 ? (
                  <span style={{ color: 'var(--status-yellow)' }}>
                    {t('dashboard.openDispatches')}: {ws.openDispatchCount}
                  </span>
                ) : null}
                <span>
                  {t('dashboard.lastActivity')}: {formatRelativeTime(ws.lastActivityAt)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
