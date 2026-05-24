import { Feather } from 'lucide-react'
import { useEffect, useState } from 'react'

import { type FeishuTransportStatus, fetchFeishuTransportStatus } from '../api.js'
import { type TranslationKey, useI18n } from '../i18n.js'
import { Tooltip } from '../ui/Tooltip.js'

const STATUS_COLOR: Record<FeishuTransportStatus['status'], string> = {
  connected: 'var(--status-green)',
  disabled: 'var(--text-tertiary)',
  disconnected: 'var(--status-orange)',
  error: 'var(--status-red)',
}

const statusLabelKey = (status: FeishuTransportStatus['status']): TranslationKey =>
  `feishu.status.${status}`

export const FeishuStatusIndicator = () => {
  const { t } = useI18n()
  const [status, setStatus] = useState<FeishuTransportStatus>({ status: 'disabled' })

  useEffect(() => {
    let cancelled = false
    const load = () => {
      void fetchFeishuTransportStatus()
        .then((next) => {
          if (!cancelled) setStatus(next)
        })
        .catch(() => {
          if (!cancelled) setStatus({ status: 'error' })
        })
    }
    load()
    const interval = window.setInterval(load, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  const statusLabel = t(statusLabelKey(status.status))
  const label = (
    <span className="flex flex-col gap-0.5">
      <span>{t('feishu.indicator.tooltip', { status: statusLabel })}</span>
      {status.appId ? <span className="mono text-ter">{status.appId}</span> : null}
      {status.reconnectCount ? (
        <span className="text-ter">
          {t('feishu.indicator.reconnects', { count: status.reconnectCount })}
        </span>
      ) : null}
    </span>
  )

  return (
    <Tooltip label={label}>
      <span
        className="flex h-7 items-center gap-1.5 rounded px-2 text-xs text-ter"
        data-testid="feishu-status-indicator"
      >
        <Feather size={13} aria-hidden style={{ color: STATUS_COLOR[status.status] }} />
        <span className="hidden sm:inline">{t('feishu.label')}</span>
      </span>
    </Tooltip>
  )
}
