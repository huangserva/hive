import { Check, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import {
  type CliAgentDetection,
  type CliPresetId,
  fetchCliDetection,
  setManualCliPath,
} from '../api.js'
import { useI18n } from '../i18n.js'
import { cliDisplayName, formatInstallCommand, summarizeCliStatus } from './cli-detection-format.js'

const CliRow = ({ agent, onChanged }: { agent: CliAgentDetection; onChanged: () => void }) => {
  const { t } = useI18n()
  const [showPathInput, setShowPathInput] = useState(false)
  const [path, setPath] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const installCommand = formatInstallCommand(agent.installPlan)

  const submitPath = useCallback(async () => {
    const trimmed = path.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setError(null)
    try {
      await setManualCliPath(agent.presetId as CliPresetId, trimmed)
      setShowPathInput(false)
      setPath('')
      onChanged()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }, [agent.presetId, onChanged, path, saving])

  return (
    <div className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5">
          {agent.installed ? (
            <Check size={15} style={{ color: 'var(--status-green)' }} />
          ) : (
            <X size={15} style={{ color: 'var(--status-red)' }} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-pri text-sm">{cliDisplayName(agent.presetId)}</span>
            {agent.installed ? (
              agent.version ? (
                <span className="text-ter text-xs">{agent.version}</span>
              ) : null
            ) : (
              <span className="text-xs" style={{ color: 'var(--status-red)' }}>
                {t('settings.cli.notInstalled')}
              </span>
            )}
          </div>
          {agent.installed && agent.path ? (
            <div className="mono mt-0.5 break-all text-ter text-xs">{agent.path}</div>
          ) : null}
          {!agent.installed && installCommand ? (
            <div className="mt-1.5">
              <div className="text-sec text-xs">{agent.installPlan?.description}</div>
              <code
                className="mono mt-1 block break-all rounded px-2 py-1 text-xs"
                style={{ background: 'var(--bg-2)', color: 'var(--accent)' }}
              >
                {installCommand}
              </code>
            </div>
          ) : null}
          <button
            className="mt-2 text-ter text-xs underline hover:text-sec"
            onClick={() => setShowPathInput((value) => !value)}
            type="button"
          >
            {t('settings.cli.manualPathToggle')}
          </button>
          {showPathInput ? (
            <div className="mt-2 space-y-1.5">
              <div className="flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded border bg-2 px-2 py-1 text-pri text-xs"
                  onChange={(event) => setPath(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void submitPath()
                  }}
                  placeholder={t('settings.cli.manualPathPlaceholder')}
                  style={{ borderColor: 'var(--border)' }}
                  value={path}
                />
                <button
                  className="icon-btn icon-btn--primary shrink-0"
                  disabled={saving || !path.trim()}
                  onClick={() => void submitPath()}
                  type="button"
                >
                  {saving ? t('common.loading') : t('settings.cli.manualPathSave')}
                </button>
              </div>
              {error ? (
                <div className="text-xs" style={{ color: 'var(--status-red)' }}>
                  {error}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export const CliDetectionPanel = () => {
  const { t } = useI18n()
  const [agents, setAgents] = useState<CliAgentDetection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setAgents(await fetchCliDetection())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const status = summarizeCliStatus(agents)

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium text-pri text-sm">{t('settings.cli.title')}</h3>
          {!loading && !error ? (
            <p className="text-ter text-xs">
              {t('settings.cli.summary', { installed: status.installed, total: status.total })}
            </p>
          ) : null}
        </div>
        <button
          aria-label={t('settings.cli.recheck')}
          className="icon-btn"
          disabled={loading}
          onClick={() => void load()}
          type="button"
        >
          <RefreshCw size={14} />
          <span className="ml-1 text-xs">{t('settings.cli.recheck')}</span>
        </button>
      </div>
      {loading ? (
        <div className="text-sec text-sm">{t('common.loading')}</div>
      ) : error ? (
        <div className="text-warn text-sm">{error}</div>
      ) : (
        <div className="space-y-2">
          {agents.map((agent) => (
            <CliRow agent={agent} key={agent.presetId} onChanged={() => void load()} />
          ))}
        </div>
      )}
    </section>
  )
}
