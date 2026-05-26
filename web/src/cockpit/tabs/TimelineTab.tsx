import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { TeamListItem } from '../../../../src/shared/types.js'
import {
  type DispatchState,
  listWorkers,
  listWorkspaceDispatches,
  type WorkspaceDispatch,
} from '../../api.js'
import { useI18n } from '../../i18n.js'

type WorkerStat = {
  avgCompletionMs: number | null
  cancelled: number
  reported: number
  total: number
  workerId: string
  workerName: string
}

const HISTORY_LIMIT = 100
const STATUS_FILTERS: Array<'all' | DispatchState> = ['all', 'reported', 'submitted', 'cancelled']

const formatDateTime = (value: number | null) => {
  if (!value) return '—'
  return new Date(value).toLocaleString('sv-SE', { hour12: false }).slice(0, 16)
}

const formatDuration = (ms: number | null) => {
  if (ms === null) return '—'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

const summary = (text: string, maxLength = 60) =>
  text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`

const stateColor = (state: DispatchState) => {
  if (state === 'reported') return 'var(--status-green)'
  if (state === 'cancelled') return 'var(--text-tertiary)'
  return 'var(--status-yellow)'
}

const getDispatchTime = (dispatch: WorkspaceDispatch) =>
  dispatch.submittedAt ?? dispatch.createdAt ?? dispatch.deliveredAt ?? 0

const dayKey = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10)

const getWorkerName = (workersById: Map<string, TeamListItem>, workerId: string) =>
  workersById.get(workerId)?.name ?? workerId

const buildWorkerStats = (
  dispatches: WorkspaceDispatch[],
  workersById: Map<string, TeamListItem>
): WorkerStat[] => {
  const stats = new Map<
    string,
    WorkerStat & { completionTotalMs: number; completionCount: number }
  >()
  for (const dispatch of dispatches) {
    const current =
      stats.get(dispatch.toAgentId) ??
      ({
        avgCompletionMs: null,
        cancelled: 0,
        completionCount: 0,
        completionTotalMs: 0,
        reported: 0,
        total: 0,
        workerId: dispatch.toAgentId,
        workerName: getWorkerName(workersById, dispatch.toAgentId),
      } satisfies WorkerStat & { completionCount: number; completionTotalMs: number })
    current.total += 1
    if (dispatch.state === 'reported') current.reported += 1
    if (dispatch.state === 'cancelled') current.cancelled += 1
    if (dispatch.state === 'reported' && dispatch.submittedAt && dispatch.reportedAt) {
      current.completionTotalMs += Math.max(0, dispatch.reportedAt - dispatch.submittedAt)
      current.completionCount += 1
      current.avgCompletionMs = current.completionTotalMs / current.completionCount
    }
    stats.set(dispatch.toAgentId, current)
  }
  return [...stats.values()].sort(
    (a, b) => b.total - a.total || a.workerName.localeCompare(b.workerName)
  )
}

const buildTrend = (dispatches: WorkspaceDispatch[]) => {
  const counts = new Map<string, number>()
  for (const dispatch of dispatches) {
    counts.set(
      dayKey(getDispatchTime(dispatch)),
      (counts.get(dayKey(getDispatchTime(dispatch))) ?? 0) + 1
    )
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-14)
    .map(([date, count]) => ({ count, date }))
}

const WorkerStats = ({ stats }: { stats: WorkerStat[] }) => {
  const { t } = useI18n()
  return (
    <section className="space-y-2">
      <h3 className="font-medium text-pri text-sm">{t('cockpit.workerStats')}</h3>
      <div className="grid gap-2 md:grid-cols-2">
        {stats.map((stat) => (
          <div
            className="rounded border p-3"
            key={stat.workerId}
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="mb-2 font-medium text-pri text-sm">{stat.workerName}</div>
            <div className="grid grid-cols-2 gap-2 text-sec text-xs">
              <span>{t('cockpit.timeline.dispatchCount', { count: stat.total })}</span>
              <span>{t('cockpit.timeline.reportedCount', { count: stat.reported })}</span>
              <span>{t('cockpit.timeline.cancelledCount', { count: stat.cancelled })}</span>
              <span>
                {t('cockpit.avgCompletionTime')}: {formatDuration(stat.avgCompletionMs)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

const DispatchTrend = ({ dispatches }: { dispatches: WorkspaceDispatch[] }) => {
  const { t } = useI18n()
  const trend = buildTrend(dispatches)
  const max = Math.max(1, ...trend.map((item) => item.count))
  return (
    <section className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
      <div className="mb-3 font-medium text-pri text-sm">{t('cockpit.dispatchTrend')}</div>
      <div
        aria-label={t('cockpit.dispatchTrend')}
        className="flex h-24 items-end gap-1.5"
        role="img"
      >
        {trend.map((item) => (
          <div className="flex min-w-8 flex-1 flex-col items-center gap-1" key={item.date}>
            <div
              className="w-full rounded-t"
              style={{
                background: 'var(--accent)',
                height: `${Math.max(8, (item.count / max) * 80)}px`,
                opacity: 0.55,
              }}
              title={`${item.date}: ${item.count}`}
            />
            <span className="text-[10px] text-ter">{item.date.slice(5)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

const DispatchRow = ({
  dispatch,
  expanded,
  onToggle,
  workerName,
}: {
  dispatch: WorkspaceDispatch
  expanded: boolean
  onToggle: () => void
  workerName: string
}) => {
  const { t } = useI18n()
  return (
    <div className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
      <button
        className="flex w-full cursor-pointer items-start gap-3 text-left"
        onClick={onToggle}
        type="button"
      >
        <span className="mt-0.5 text-ter">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="mb-1 flex flex-wrap items-center gap-2 text-xs">
            <span className="mono text-ter">{formatDateTime(getDispatchTime(dispatch))}</span>
            <span className="font-medium text-pri">{workerName}</span>
            <span
              className="rounded-full border px-2 py-0.5 text-[10px]"
              style={{
                borderColor: 'color-mix(in oklab, currentColor 35%, transparent)',
                color: stateColor(dispatch.state),
              }}
            >
              {dispatch.state}
            </span>
          </span>
          <span className="block text-sec text-sm">{summary(dispatch.text)}</span>
        </span>
      </button>
      {expanded ? (
        <div
          className="mt-3 space-y-2 border-t pt-3 text-sm"
          style={{ borderColor: 'var(--border)' }}
        >
          <div>
            <div className="mb-1 text-ter text-xs">{t('cockpit.timeline.fullTask')}</div>
            <p className="whitespace-pre-wrap text-sec">{dispatch.text}</p>
          </div>
          {dispatch.reportText ? (
            <div>
              <div className="mb-1 text-ter text-xs">{t('cockpit.timeline.report')}</div>
              <p className="whitespace-pre-wrap text-sec">{dispatch.reportText}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export const TimelineTab = ({ workspaceId }: { workspaceId: string }) => {
  const { t } = useI18n()
  const [dispatches, setDispatches] = useState<WorkspaceDispatch[]>([])
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | DispatchState>('all')
  const [workerFilter, setWorkerFilter] = useState('all')
  const [workers, setWorkers] = useState<TeamListItem[]>([])

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void Promise.all([
      listWorkspaceDispatches(workspaceId, { limit: HISTORY_LIMIT }),
      listWorkers(workspaceId),
    ])
      .then(([nextDispatches, nextWorkers]) => {
        if (cancelled) return
        setDispatches([...nextDispatches].sort((a, b) => getDispatchTime(b) - getDispatchTime(a)))
        setWorkers(nextWorkers)
      })
      .catch((error) => {
        if (!cancelled) setError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const workersById = useMemo(
    () => new Map(workers.map((worker) => [worker.id, worker])),
    [workers]
  )
  const stats = useMemo(() => buildWorkerStats(dispatches, workersById), [dispatches, workersById])
  const filteredDispatches = dispatches.filter((dispatch) => {
    if (workerFilter !== 'all' && dispatch.toAgentId !== workerFilter) return false
    if (statusFilter !== 'all' && dispatch.state !== statusFilter) return false
    return true
  })

  if (loading) return <div className="px-5 py-4 text-sec text-sm">{t('common.loading')}</div>
  if (error) return <div className="px-5 py-4 text-warn text-sm">{error}</div>

  return (
    <div className="scroll-y space-y-4 px-5 py-4">
      <header>
        <h2 className="font-semibold text-pri text-sm">{t('cockpit.timeline')}</h2>
        <p className="mt-1 text-sec text-xs">{t('cockpit.timelineDesc')}</p>
      </header>
      <WorkerStats stats={stats} />
      <DispatchTrend dispatches={dispatches} />
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-medium text-pri text-sm">{t('cockpit.timeline.history')}</h3>
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="timeline-worker-filter">
              {t('cockpit.timeline.workerFilter')}
            </label>
            <select
              className="rounded border bg-2 px-2 py-1 text-sec text-xs"
              id="timeline-worker-filter"
              onChange={(event) => setWorkerFilter(event.target.value)}
              style={{ borderColor: 'var(--border)' }}
              value={workerFilter}
            >
              <option value="all">{t('cockpit.timeline.allWorkers')}</option>
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.name}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="timeline-status-filter">
              {t('cockpit.timeline.statusFilter')}
            </label>
            <select
              className="rounded border bg-2 px-2 py-1 text-sec text-xs"
              id="timeline-status-filter"
              onChange={(event) => setStatusFilter(event.target.value as 'all' | DispatchState)}
              style={{ borderColor: 'var(--border)' }}
              value={statusFilter}
            >
              {STATUS_FILTERS.map((state) => (
                <option key={state} value={state}>
                  {state === 'all' ? t('cockpit.timeline.allStatuses') : state}
                </option>
              ))}
            </select>
          </div>
        </div>
        {filteredDispatches.length ? (
          <div className="space-y-2">
            {filteredDispatches.map((dispatch) => (
              <DispatchRow
                dispatch={dispatch}
                expanded={expandedId === dispatch.id}
                key={dispatch.id}
                onToggle={() => setExpandedId(expandedId === dispatch.id ? null : dispatch.id)}
                workerName={getWorkerName(workersById, dispatch.toAgentId)}
              />
            ))}
          </div>
        ) : (
          <p
            className="rounded border p-3 text-sec text-sm"
            style={{ borderColor: 'var(--border)' }}
          >
            {t('cockpit.timeline.empty')}
          </p>
        )}
      </section>
    </div>
  )
}
