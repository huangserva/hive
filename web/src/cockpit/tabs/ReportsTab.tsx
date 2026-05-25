import { ExternalLink } from 'lucide-react'

import type { ParsedReports, PMReportEntry } from '../../api.js'
import { useI18n } from '../../i18n.js'

const formatMtime = (mtime: string) =>
  new Date(mtime).toLocaleString('sv-SE', { hour12: false }).slice(0, 16)

const ReportEntryCard = ({ entry, workspaceId }: { entry: PMReportEntry; workspaceId: string }) => {
  const { t } = useI18n()
  const openReport = () => {
    if (!workspaceId) return
    const url = `/api/workspaces/${workspaceId}/cockpit/report-file?path=${encodeURIComponent(
      entry.path
    )}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }
  return (
    <div className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
      <div className="mb-1 flex items-center gap-2 text-ter text-xs">
        <span>{formatMtime(entry.mtime)}</span>
        <span className="mono truncate">{entry.filename}</span>
        <span className="tabular-nums">
          {t('cockpit.reports.lineCount', { count: entry.size })}
        </span>
      </div>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-pri text-sm">{entry.title}</div>
          <div className="mt-1 text-sec text-xs">{entry.topic}</div>
        </div>
        <button
          aria-label={t('cockpit.reports.open')}
          className="icon-btn h-8 px-2 text-xs"
          disabled={!workspaceId}
          onClick={openReport}
          type="button"
        >
          <ExternalLink size={13} aria-hidden />
          {t('cockpit.reports.open')}
        </button>
      </div>
    </div>
  )
}

export const ReportsTab = ({
  reports,
  workspaceId,
}: {
  reports: ParsedReports
  workspaceId: string
}) => {
  const { t } = useI18n()
  return (
    <div className="scroll-y space-y-4 px-5 py-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-pri text-sm">{t('cockpit.reports.title')}</h3>
        <span className="text-ter text-xs tabular-nums">{reports.totalCount}</span>
      </div>
      {reports.parseError ? (
        <div
          className="rounded border px-3 py-2 text-sm text-warn"
          style={{ borderColor: 'var(--border)' }}
        >
          {t('cockpit.reports.parseWarning', { message: reports.parseError })}
        </div>
      ) : null}
      <div className="space-y-2">
        {reports.entries.length ? (
          reports.entries.map((entry) => (
            <ReportEntryCard entry={entry} key={entry.filename} workspaceId={workspaceId} />
          ))
        ) : (
          <p
            className="rounded border p-3 text-sec text-sm"
            style={{ borderColor: 'var(--border)' }}
          >
            {t('cockpit.reports.empty')}
          </p>
        )}
      </div>
    </div>
  )
}
