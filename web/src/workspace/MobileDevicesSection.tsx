import { LoaderCircle, Pencil, ShieldAlert, Smartphone } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  generatePairingCode,
  listMobileDevices,
  type MobileCapability,
  type MobileDevice,
  type PairingCodeResult,
  revokeMobileDevice,
  updateMobileDevice,
} from '../api.js'
import { useI18n } from '../i18n.js'
import { Confirm } from '../ui/Confirm.js'

const ALL_CAPABILITIES: MobileCapability[] = [
  'read_dashboard',
  'read_terminal',
  'send_prompt',
  'approve_risk',
  'admin_runtime',
]

const CAPABILITY_LABELS: Record<MobileCapability, string> = {
  admin_runtime: 'Admin',
  approve_risk: 'Approve',
  read_dashboard: 'Dashboard',
  read_terminal: 'Terminal',
  send_prompt: 'Prompt',
}

interface FieldLabelProps {
  children: React.ReactNode
}

const FieldLabel = ({ children }: FieldLabelProps) => (
  <span className="text-xs font-medium uppercase tracking-wider text-ter">{children}</span>
)

interface DeviceRowProps {
  device: MobileDevice
  onEdit: () => void
  onRevoke: () => void
  t: (key: string, values?: Record<string, string | number>) => string
}

const DeviceRow = ({ device, onEdit, onRevoke, t }: DeviceRowProps) => {
  const isRevoked = device.revoked_at !== null
  const lastSeen = device.last_seen_at
    ? new Date(device.last_seen_at).toLocaleString()
    : t('mobile.never')

  return (
    <div
      className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0"
      style={{
        borderColor: 'var(--border)',
        opacity: isRevoked ? 0.5 : 1,
      }}
      data-testid={`device-row-${device.id}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-pri">{device.name}</span>
          {isRevoked ? (
            <span className="pill pill--red text-[10px]">{t('mobile.revoked')}</span>
          ) : null}
          {device.device_type === 'legacy_m19a' ? (
            <span className="pill pill--neutral text-[10px]">{t('mobile.legacy')}</span>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ter">
          {device.capabilities.map((cap) => (
            <span key={cap} className="pill pill--ghost text-[10px]">
              {CAPABILITY_LABELS[cap as MobileCapability] ?? cap}
            </span>
          ))}
          <span className="ml-2">
            {t('mobile.lastSeen')}: {lastSeen}
          </span>
        </div>
      </div>
      {!isRevoked ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="worker-card__action"
            aria-label={t('mobile.edit')}
            onClick={onEdit}
          >
            <Pencil size={12} aria-hidden />
          </button>
          <button
            type="button"
            className="worker-card__action"
            aria-label={t('mobile.revoke')}
            onClick={onRevoke}
          >
            <ShieldAlert size={12} aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  )
}

export const MobileDevicesSection = () => {
  const { t } = useI18n()
  const [devices, setDevices] = useState<MobileDevice[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pairingResult, setPairingResult] = useState<PairingCodeResult | null>(null)
  const [generating, setGenerating] = useState(false)
  const [showGenerator, setShowGenerator] = useState(false)
  const [genName, setGenName] = useState('')
  const [genCaps, setGenCaps] = useState<MobileCapability[]>([...ALL_CAPABILITIES])
  const [revokeTarget, setRevokeTarget] = useState<MobileDevice | null>(null)
  const [editTarget, setEditTarget] = useState<MobileDevice | null>(null)
  const [editName, setEditName] = useState('')
  const [editCaps, setEditCaps] = useState<MobileCapability[]>([])
  const [editSaving, setEditSaving] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadDevices = useCallback(() => {
    setLoading(true)
    setError(null)
    listMobileDevices()
      .then(setDevices)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadDevices()
  }, [loadDevices])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])
  const startCountdown = (expiresAt: number) => {
    if (timerRef.current) clearInterval(timerRef.current)
    const update = () => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
      setCountdown(remaining)
      if (remaining <= 0 && timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
        setPairingResult(null)
      }
    }
    update()
    timerRef.current = setInterval(update, 1000)
  }

  const handleGenerate = () => {
    if (!genName.trim()) return
    setGenerating(true)
    setError(null)
    generatePairingCode(genName.trim(), genCaps)
      .then((result) => {
        setPairingResult(result)
        startCountdown(result.expires_at)
        setShowGenerator(false)
        setGenName('')
        setGenCaps([...ALL_CAPABILITIES])
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setGenerating(false))
  }

  const handleRevoke = () => {
    if (!revokeTarget) return
    revokeMobileDevice(revokeTarget.id)
      .then(() => {
        setDevices((prev) =>
          prev.map((d) =>
            d.id === revokeTarget.id ? { ...d, revoked_at: new Date().toISOString() } : d
          )
        )
        setRevokeTarget(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  const handleEditSave = () => {
    if (!editTarget) return
    setEditSaving(true)
    updateMobileDevice(editTarget.id, { capabilities: editCaps, name: editName.trim() })
      .then((updated) => {
        setDevices((prev) => prev.map((d) => (d.id === updated.id ? updated : d)))
        setEditTarget(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setEditSaving(false))
  }

  const toggleCap = (
    caps: MobileCapability[],
    setCaps: (c: MobileCapability[]) => void,
    cap: MobileCapability
  ) => {
    setCaps(caps.includes(cap) ? caps.filter((c) => c !== cap) : [...caps, cap])
  }

  const minutes = Math.floor(countdown / 60)
  const seconds = countdown % 60

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Smartphone size={14} className="text-ter" aria-hidden />
          <FieldLabel>{t('mobile.devices')}</FieldLabel>
        </div>
        {loading ? <LoaderCircle size={14} className="animate-spin text-ter" /> : null}
      </div>

      {error ? (
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{
            background: 'color-mix(in oklab, var(--status-red) 8%, transparent)',
            borderColor: 'color-mix(in oklab, var(--status-red) 25%, transparent)',
            color: 'var(--status-red)',
          }}
        >
          {error}
        </div>
      ) : null}

      {pairingResult ? (
        <div
          className="flex flex-col items-center gap-2 rounded border px-4 py-4"
          style={{ borderColor: 'var(--border)' }}
          data-testid="pairing-code-display"
        >
          <span className="text-xs uppercase tracking-wider text-ter">
            {t('mobile.pairingCode')}
          </span>
          <code className="mono text-4xl font-bold tracking-[0.3em] text-pri">
            {pairingResult.code}
          </code>
          <span className="text-xs text-ter">
            {t('mobile.codeExpires', { minutes: String(minutes), seconds: String(seconds) })}
          </span>
        </div>
      ) : null}

      {showGenerator ? (
        <div
          className="flex flex-col gap-3 rounded border px-3 py-3"
          style={{ borderColor: 'var(--border)' }}
          data-testid="pairing-generator"
        >
          <label className="flex flex-col gap-1.5">
            <FieldLabel>{t('mobile.deviceName')}</FieldLabel>
            <input
              className="input"
              placeholder="My iPhone"
              value={genName}
              onChange={(e) => setGenName(e.target.value)}
              data-testid="pairing-device-name"
            />
          </label>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>{t('mobile.capabilities')}</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {ALL_CAPABILITIES.map((cap) => (
                <label key={cap} className="inline-flex items-center gap-1.5 text-xs text-sec">
                  <input
                    type="checkbox"
                    checked={genCaps.includes(cap)}
                    onChange={() => toggleCap(genCaps, setGenCaps, cap)}
                  />
                  {CAPABILITY_LABELS[cap]}
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="icon-btn" onClick={() => setShowGenerator(false)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="icon-btn icon-btn--primary"
              disabled={!genName.trim() || genCaps.length === 0 || generating}
              onClick={handleGenerate}
              data-testid="pairing-confirm"
            >
              {generating ? t('mobile.generating') : t('mobile.generateCode')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="icon-btn icon-btn--primary self-start"
          onClick={() => setShowGenerator(true)}
          data-testid="generate-pairing-btn"
        >
          {t('mobile.generateCode')}
        </button>
      )}

      {devices.length === 0 && !loading ? (
        <div
          className="rounded border px-3 py-3 text-sm text-ter"
          style={{ borderColor: 'var(--border)' }}
        >
          {t('mobile.noDevices')}
        </div>
      ) : devices.length > 0 ? (
        <div
          className="flex flex-col overflow-hidden rounded border"
          style={{ borderColor: 'var(--border)' }}
          data-testid="device-list"
        >
          {devices.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              onEdit={() => {
                setEditTarget(device)
                setEditName(device.name)
                setEditCaps([...device.capabilities])
              }}
              onRevoke={() => setRevokeTarget(device)}
              t={t}
            />
          ))}
        </div>
      ) : null}

      {editTarget ? (
        <div
          className="flex flex-col gap-3 rounded border px-3 py-3"
          style={{ borderColor: 'var(--accent)', background: 'var(--bg-3)' }}
          data-testid="device-edit-form"
        >
          <label className="flex flex-col gap-1.5">
            <FieldLabel>{t('mobile.deviceName')}</FieldLabel>
            <input
              className="input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
          </label>
          <div className="flex flex-col gap-1.5">
            <FieldLabel>{t('mobile.capabilities')}</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {ALL_CAPABILITIES.map((cap) => (
                <label key={cap} className="inline-flex items-center gap-1.5 text-xs text-sec">
                  <input
                    type="checkbox"
                    checked={editCaps.includes(cap)}
                    onChange={() => toggleCap(editCaps, setEditCaps, cap)}
                  />
                  {CAPABILITY_LABELS[cap]}
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="icon-btn" onClick={() => setEditTarget(null)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="icon-btn icon-btn--primary"
              disabled={!editName.trim() || editCaps.length === 0 || editSaving}
              onClick={handleEditSave}
            >
              {editSaving ? t('common.saving') : t('mobile.save')}
            </button>
          </div>
        </div>
      ) : null}

      <Confirm
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null)
        }}
        title={revokeTarget ? t('mobile.revokeConfirm', { name: revokeTarget.name }) : ''}
        description=""
        confirmLabel={t('mobile.revoke')}
        confirmKind="danger"
        onConfirm={handleRevoke}
      />
    </section>
  )
}
