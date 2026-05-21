import { Feather } from 'lucide-react'
import { useEffect, useState } from 'react'

import { type FeishuTransportStatus, fetchFeishuTransportStatus } from '../api.js'
import { Tooltip } from '../ui/Tooltip.js'

const STATUS_COLOR: Record<FeishuTransportStatus['status'], string> = {
  connected: 'var(--status-green)',
  disabled: 'var(--text-tertiary)',
  disconnected: 'var(--status-orange)',
  error: 'var(--status-red)',
}

const STATUS_LABEL: Record<FeishuTransportStatus['status'], string> = {
  connected: 'Connected',
  disabled: 'Not configured',
  disconnected: 'Reconnecting',
  error: 'Error',
}

export const FeishuStatusIndicator = () => {
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

  const label = (
    <span className="flex flex-col gap-0.5">
      <span>Feishu: {STATUS_LABEL[status.status]}</span>
      {status.appId ? <span className="mono text-ter">{status.appId}</span> : null}
      {status.reconnectCount ? (
        <span className="text-ter">Reconnects: {status.reconnectCount}</span>
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
        <span className="hidden sm:inline">Feishu</span>
      </span>
    </Tooltip>
  )
}
