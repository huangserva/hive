import { AlertTriangle, Check, Download, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import {
  type Diagnostics,
  downloadDiagnosticsExport,
  fetchDiagnostics,
  SECRET_KEYS,
} from '../../api.js'
import {
  describeSpawnFailure,
  formatPlatformLine,
  isSpawnFailureEvent,
  sentinelTierAccent,
} from '../../diagnostics/diagnostics-format.js'
import { useI18n } from '../../i18n.js'
import { cliDisplayName } from '../../settings/cli-detection-format.js'

const formatTime = (value: number) =>
  new Date(value).toLocaleString('sv-SE', { hour12: false }).slice(0, 19)

const EnvInfo = ({ diagnostics }: { diagnostics: Diagnostics }) => {
  const { t } = useI18n()
  const info = diagnostics.systemInfo
  const rows: Array<[string, string]> = [
    [
      t('diagnostics.env.platform'),
      formatPlatformLine({
        appVersion: info.app_version,
        arch: info.arch,
        platform: info.platform,
        port: info.port,
      }),
    ],
    [t('diagnostics.env.node'), info.node_version],
    [t('diagnostics.env.dataDir'), info.data_dir],
    [t('diagnostics.env.logPath'), info.log_path],
    [t('diagnostics.env.generatedAt'), formatTime(diagnostics.generatedAt)],
  ]
  return (
    <section className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
      <h3 className="mb-2 font-medium text-pri text-sm">{t('diagnostics.env.title')}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {rows.map(([label, value]) => (
          <div className="contents" key={label}>
            <dt className="text-ter">{label}</dt>
            <dd className="mono break-all text-sec">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

const CliAndSecrets = ({ diagnostics }: { diagnostics: Diagnostics }) => {
  const { t } = useI18n()
  return (
    <section className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
      <h3 className="mb-2 font-medium text-pri text-sm">{t('diagnostics.status.title')}</h3>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {diagnostics.cliDetection.map((agent) => (
          <span className="flex items-center gap-1 text-xs" key={agent.presetId}>
            {agent.installed ? (
              <Check size={13} style={{ color: 'var(--status-green)' }} />
            ) : (
              <X size={13} style={{ color: 'var(--status-red)' }} />
            )}
            <span className="text-sec">{cliDisplayName(agent.presetId)}</span>
          </span>
        ))}
      </div>
      <div
        className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 border-t pt-2"
        style={{ borderColor: 'var(--border)' }}
      >
        {SECRET_KEYS.map((key) => (
          <span className="flex items-center gap-1 text-xs" key={key}>
            {diagnostics.secrets[key]?.present ? (
              <Check size={13} style={{ color: 'var(--status-green)' }} />
            ) : (
              <X size={13} style={{ color: 'var(--text-tertiary)' }} />
            )}
            <span className="mono text-sec">{key}</span>
          </span>
        ))}
      </div>
    </section>
  )
}

const SpawnFailures = ({ diagnostics }: { diagnostics: Diagnostics }) => {
  const { t } = useI18n()
  const failures = diagnostics.events.filter(isSpawnFailureEvent)
  if (failures.length === 0) return null
  return (
    <section className="space-y-2">
      <h3 className="font-medium text-pri text-sm">{t('diagnostics.spawnFailures.title')}</h3>
      {failures.map((event) => {
        const view = describeSpawnFailure(event.payload)
        return (
          <div
            className="rounded border p-3"
            key={event.id}
            style={{
              background: 'color-mix(in oklab, var(--status-red) 8%, transparent)',
              borderColor: 'color-mix(in oklab, var(--status-red) 35%, transparent)',
            }}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} style={{ color: 'var(--status-red)' }} />
              <span className="font-medium text-pri text-sm">{view.worker}</span>
              <span className="text-ter text-xs">{formatTime(event.created_at)}</span>
            </div>
            <div className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <span className="text-ter">{t('diagnostics.spawnFailures.command')}</span>
              <span className="mono break-all text-sec">{view.command || '—'}</span>
              <span className="text-ter">{t('diagnostics.spawnFailures.error')}</span>
              <span className="mono break-all" style={{ color: 'var(--status-red)' }}>
                {view.error || '—'}
              </span>
              <span className="text-ter">{t('diagnostics.spawnFailures.path')}</span>
              <span className="mono break-all text-sec">{view.path || '—'}</span>
            </div>
          </div>
        )
      })}
    </section>
  )
}

const SentinelAlerts = ({ diagnostics }: { diagnostics: Diagnostics }) => {
  const { t } = useI18n()
  if (diagnostics.sentinelAlerts.length === 0) return null
  return (
    <section className="space-y-2">
      <h3 className="font-medium text-pri text-sm">{t('diagnostics.sentinel.title')}</h3>
      {diagnostics.sentinelAlerts.map((alert) => (
        <div
          className="rounded border p-3"
          key={`${alert.workspace_name}:${alert.ruleId}:${alert.title}`}
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full border px-2 py-0.5 text-[10px] uppercase"
              style={{
                borderColor: 'color-mix(in oklab, currentColor 35%, transparent)',
                color: sentinelTierAccent(alert.tier),
              }}
            >
              {alert.tier}
            </span>
            <span className="font-medium text-pri text-sm">{alert.title}</span>
            <span className="text-ter text-xs">{alert.workspace_name}</span>
          </div>
          <p className="mt-1 text-sec text-xs">{alert.detail}</p>
          {alert.suggestedAction ? (
            <p className="mt-1 text-ter text-xs">→ {alert.suggestedAction}</p>
          ) : null}
        </div>
      ))}
    </section>
  )
}

const LogTail = ({ diagnostics }: { diagnostics: Diagnostics }) => {
  const { t } = useI18n()
  return (
    <section className="space-y-2">
      <h3 className="font-medium text-pri text-sm">{t('diagnostics.log.title')}</h3>
      {diagnostics.logTail.exists ? (
        <pre
          className="mono max-h-64 overflow-auto rounded border p-2 text-[11px] leading-relaxed"
          style={{
            background: 'var(--bg-2)',
            borderColor: 'var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          {diagnostics.logTail.lines.join('\n')}
        </pre>
      ) : (
        <p className="rounded border p-3 text-sec text-sm" style={{ borderColor: 'var(--border)' }}>
          {t('diagnostics.log.empty')}
        </p>
      )}
    </section>
  )
}

export const DiagnosticsTab = () => {
  const { t } = useI18n()
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setDiagnostics(await fetchDiagnostics())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onExport = useCallback(async () => {
    if (exporting) return
    setExporting(true)
    setExportError(null)
    try {
      await downloadDiagnosticsExport()
    } catch (caught) {
      setExportError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setExporting(false)
    }
  }, [exporting])

  return (
    <div className="scroll-y space-y-4 px-5 py-4">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-pri text-sm">{t('diagnostics.title')}</h2>
          <p className="mt-1 text-sec text-xs">{t('diagnostics.subtitle')}</p>
        </div>
        <button
          aria-label={t('diagnostics.refresh')}
          className="icon-btn shrink-0"
          disabled={loading}
          onClick={() => void load()}
          type="button"
        >
          <RefreshCw size={14} />
        </button>
      </header>

      {loading ? (
        <div className="text-sec text-sm">{t('common.loading')}</div>
      ) : error ? (
        <div className="text-warn text-sm">{error}</div>
      ) : diagnostics ? (
        <>
          <EnvInfo diagnostics={diagnostics} />
          <CliAndSecrets diagnostics={diagnostics} />
          <SpawnFailures diagnostics={diagnostics} />
          <SentinelAlerts diagnostics={diagnostics} />
          <LogTail diagnostics={diagnostics} />
        </>
      ) : null}

      <section className="space-y-1.5 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
        <button
          className="icon-btn icon-btn--primary"
          disabled={exporting}
          onClick={() => void onExport()}
          type="button"
        >
          <Download size={14} />
          <span className="ml-1">
            {exporting ? t('diagnostics.export.busy') : t('diagnostics.export.button')}
          </span>
        </button>
        <p className="text-ter text-xs">{t('diagnostics.export.redactedHint')}</p>
        {exportError ? (
          <p className="text-xs" style={{ color: 'var(--status-red)' }}>
            {exportError}
          </p>
        ) : null}
      </section>
    </div>
  )
}
