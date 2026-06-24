import { Check, Info } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import {
  fetchSecretsStatus,
  SECRET_KEYS,
  type SecretKey,
  type SecretsStatus,
  setSecret,
} from '../api.js'
import { type TranslationKey, useI18n } from '../i18n.js'

const KEY_LABELS: Record<SecretKey, TranslationKey> = {
  ANTHROPIC_API_KEY: 'settings.keys.anthropicApiKey',
  ANTHROPIC_AUTH_TOKEN: 'settings.keys.anthropicAuthToken',
  GLM_API_KEY: 'settings.keys.glmApiKey',
}

const KeyRow = ({
  present,
  secretKey,
  onSaved,
}: {
  onSaved: () => void
  present: boolean
  secretKey: SecretKey
}) => {
  const { t } = useI18n()
  const [value, setValue] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = useCallback(async () => {
    if (!value || saving) return
    setSaving(true)
    setError(null)
    try {
      await setSecret(secretKey, value)
      setValue('')
      setEditing(false)
      onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }, [onSaved, saving, secretKey, value])

  return (
    <div className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-pri text-sm">{t(KEY_LABELS[secretKey])}</span>
          {present ? (
            <span
              className="flex items-center gap-1 text-xs"
              style={{ color: 'var(--status-green)' }}
            >
              <Check size={13} /> {t('settings.keys.configured')}
            </span>
          ) : (
            <span className="text-ter text-xs">{t('settings.keys.notConfigured')}</span>
          )}
        </div>
        {!editing ? (
          <button className="icon-btn" onClick={() => setEditing(true)} type="button">
            <span className="text-xs">
              {present ? t('settings.keys.update') : t('settings.keys.set')}
            </span>
          </button>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-2 space-y-1.5">
          <div className="flex gap-2">
            <input
              autoComplete="off"
              className="min-w-0 flex-1 rounded border bg-2 px-2 py-1 text-pri text-xs"
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void save()
              }}
              placeholder={t('settings.keys.placeholder')}
              style={{ borderColor: 'var(--border)' }}
              type="password"
              value={value}
            />
            <button
              className="icon-btn icon-btn--primary shrink-0"
              disabled={saving || !value}
              onClick={() => void save()}
              type="button"
            >
              {saving ? t('common.loading') : t('settings.keys.save')}
            </button>
            <button
              className="icon-btn shrink-0"
              onClick={() => {
                setEditing(false)
                setValue('')
                setError(null)
              }}
              type="button"
            >
              <span className="text-xs">{t('settings.keys.cancel')}</span>
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
  )
}

export const ApiKeysPanel = () => {
  const { t } = useI18n()
  const [status, setStatus] = useState<SecretsStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setStatus(await fetchSecretsStatus())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="space-y-2">
      <div>
        <h3 className="font-medium text-pri text-sm">{t('settings.keys.title')}</h3>
        <p className="text-ter text-xs">{t('settings.keys.subtitle')}</p>
      </div>
      <div
        className="flex items-start gap-2 rounded border p-2.5 text-xs"
        style={{
          background: 'color-mix(in oklab, var(--status-yellow) 12%, transparent)',
          borderColor: 'color-mix(in oklab, var(--status-yellow) 35%, transparent)',
          color: 'var(--text-secondary)',
        }}
      >
        <Info size={14} style={{ color: 'var(--status-yellow)', marginTop: 1 }} />
        <span>{t('settings.keys.restartNotice')}</span>
      </div>
      {loading ? (
        <div className="text-sec text-sm">{t('common.loading')}</div>
      ) : error ? (
        <div className="text-warn text-sm">{error}</div>
      ) : status ? (
        <div className="space-y-2">
          {SECRET_KEYS.map((secretKey) => (
            <KeyRow
              key={secretKey}
              onSaved={() => void load()}
              present={status[secretKey]?.present ?? false}
              secretKey={secretKey}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}
