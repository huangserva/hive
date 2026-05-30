import { Copy, LoaderCircle, Pencil, QrCode, Smartphone, Trash2 } from 'lucide-react'
import QRCode from 'qrcode'
import { useCallback, useEffect, useState } from 'react'

import {
  createMobileToken,
  getRelayConnectionInfo,
  listMobileDevices,
  type MobileCapability,
  type MobileDevice,
  type RelayConnectionInfo,
  revokeMobileDevice,
  updateMobileDevice,
} from '../api.js'
import { useI18n } from '../i18n.js'
import { useRuntimeStatus } from '../layout/useRuntimeStatus.js'
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
  onDelete: () => void
  t: ReturnType<typeof useI18n>['t']
}

const DeviceRow = ({ device, onDelete, onEdit, t }: DeviceRowProps) => {
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
          <span className="pill pill--ghost text-[10px]">{t('mobile.sourceManual')}</span>
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
            aria-label={t('mobile.delete')}
            onClick={onDelete}
          >
            <Trash2 size={12} aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  )
}

export const MobileDevicesSection = () => {
  const { t } = useI18n()
  const runtimeStatus = useRuntimeStatus()
  const [devices, setDevices] = useState<MobileDevice[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdToken, setCreatedToken] = useState<{ deviceId: string; token: string } | null>(null)
  const [createdTokenQr, setCreatedTokenQr] = useState<string | null>(null)
  const [createdTokenQrError, setCreatedTokenQrError] = useState<string | null>(null)
  const [relayInfo, setRelayInfo] = useState<RelayConnectionInfo | null>(null)
  const [creating, setCreating] = useState(false)
  const [showGenerator, setShowGenerator] = useState(false)
  const [genName, setGenName] = useState('')
  const [genCaps, setGenCaps] = useState<MobileCapability[]>([...ALL_CAPABILITIES])
  const [deleteTarget, setDeleteTarget] = useState<MobileDevice | null>(null)
  const [editTarget, setEditTarget] = useState<MobileDevice | null>(null)
  const [editName, setEditName] = useState('')
  const [editCaps, setEditCaps] = useState<MobileCapability[]>([])
  const [editSaving, setEditSaving] = useState(false)

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

  // relay 配对信息：relay.json 配好（enabled）时 QR 会额外带 relay_url/room/公钥；
  // 没配则 { enabled:false }，QR 退回纯 host/token（LAN 行为不变）。失败也不阻断 LAN QR。
  useEffect(() => {
    let alive = true
    getRelayConnectionInfo()
      .then((info) => {
        if (alive) setRelayInfo(info)
      })
      .catch(() => {
        if (alive) setRelayInfo({ enabled: false })
      })
    return () => {
      alive = false
    }
  }, [])

  const currentLanAddress = runtimeStatus?.lanAddresses[0] ?? null
  const currentMobileHost =
    currentLanAddress && runtimeStatus?.port ? `${currentLanAddress}:${runtimeStatus.port}` : null

  useEffect(() => {
    let alive = true
    setCreatedTokenQr(null)
    setCreatedTokenQrError(null)
    if (!createdToken) return
    if (!currentMobileHost) {
      setCreatedTokenQrError('No LAN IPv4 address detected on this runtime.')
      return
    }

    const qrPayload =
      relayInfo?.enabled === true
        ? {
            capabilities: genCaps,
            daemon_public_key: relayInfo.daemon_public_key,
            device_id: createdToken.deviceId,
            host: currentMobileHost,
            relay_auth_token: relayInfo.relay_auth_token,
            relay_url: relayInfo.relay_url,
            room_id: relayInfo.room_id,
            token: createdToken.token,
          }
        : { host: currentMobileHost, token: createdToken.token }

    QRCode.toDataURL(JSON.stringify(qrPayload), {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 6,
    })
      .then((dataUrl) => {
        if (alive) setCreatedTokenQr(dataUrl)
      })
      .catch((err: unknown) => {
        if (alive) setCreatedTokenQrError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [createdToken, currentMobileHost, relayInfo, genCaps])

  const handleGenerate = () => {
    if (!genName.trim()) return
    setCreating(true)
    setError(null)
    createMobileToken(genName.trim(), genCaps)
      .then((result) => {
        setCreatedToken({ deviceId: result.device_id, token: result.token })
        setShowGenerator(false)
        setGenName('')
        setGenCaps([...ALL_CAPABILITIES])
        loadDevices()
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setCreating(false))
  }

  const handleDelete = () => {
    if (!deleteTarget) return
    revokeMobileDevice(deleteTarget.id)
      .then(() => {
        setDevices((prev) => prev.filter((device) => device.id !== deleteTarget.id))
        setDeleteTarget(null)
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

      {createdToken ? (
        <div
          className="flex flex-col items-center gap-2 rounded border px-4 py-4"
          style={{ borderColor: 'var(--border)' }}
          data-testid="created-token-display"
        >
          <span className="text-xs uppercase tracking-wider text-ter">
            {t('mobile.createdToken')}
          </span>
          <code className="mono max-w-full break-all rounded bg-black/20 px-3 py-2 text-sm text-pri">
            {createdToken.token}
          </code>
          <button
            type="button"
            className="icon-btn"
            onClick={() => void navigator.clipboard?.writeText(createdToken.token)}
          >
            <Copy size={12} aria-hidden />
            {t('mobile.copyToken')}
          </button>
          <div
            className="mt-2 flex w-full max-w-sm flex-col items-center gap-2 rounded border px-3 py-3"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-3)' }}
          >
            <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-ter">
              <QrCode size={13} aria-hidden />
              Scan QR in mobile app
            </span>
            {createdTokenQr ? (
              <img
                alt="Mobile token connection QR code"
                className="h-44 w-44 rounded bg-white p-2"
                src={createdTokenQr}
              />
            ) : createdTokenQrError ? (
              <span className="text-center text-xs text-ter">{createdTokenQrError}</span>
            ) : (
              <LoaderCircle size={16} className="animate-spin text-ter" aria-hidden />
            )}
            {currentMobileHost ? (
              <span className="mono max-w-full break-all text-xs text-ter">
                host: {currentMobileHost}
              </span>
            ) : null}
          </div>
          <span className="text-xs text-ter">{t('mobile.tokenShownOnce')}</span>
        </div>
      ) : null}

      {showGenerator ? (
        <div
          className="flex flex-col gap-3 rounded border px-3 py-3"
          style={{ borderColor: 'var(--border)' }}
          data-testid="token-generator"
        >
          <label className="flex flex-col gap-1.5">
            <FieldLabel>{t('mobile.deviceName')}</FieldLabel>
            <input
              className="input"
              placeholder="My iPhone"
              value={genName}
              onChange={(e) => setGenName(e.target.value)}
              data-testid="token-device-name"
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
              disabled={!genName.trim() || genCaps.length === 0 || creating}
              onClick={handleGenerate}
              data-testid="token-confirm"
            >
              {creating ? t('mobile.creating') : t('mobile.createToken')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="icon-btn icon-btn--primary self-start"
          onClick={() => setShowGenerator(true)}
          data-testid="create-token-btn"
        >
          {t('mobile.createToken')}
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
              onDelete={() => setDeleteTarget(device)}
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
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={deleteTarget ? t('mobile.deleteConfirm', { name: deleteTarget.name }) : ''}
        description=""
        confirmLabel={t('mobile.delete')}
        confirmKind="danger"
        onConfirm={handleDelete}
      />
    </section>
  )
}
