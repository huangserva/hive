import { Server } from 'lucide-react'

import { useI18n } from '../i18n.js'
import { type RuntimeStatus, useRuntimeStatus } from './useRuntimeStatus.js'

const fileName = (path: string) => path.split('/').pop() || path

type RuntimeStatusStripProps = {
  status?: RuntimeStatus | null
}

export const RuntimeStatusStrip = ({ status: providedStatus }: RuntimeStatusStripProps) => {
  const { t } = useI18n()
  const loadedStatus = useRuntimeStatus()
  const status = providedStatus ?? loadedStatus
  if (!status) return null

  const title = [
    `${t('runtimeStatus.cwd')}: ${status.cwd}`,
    `${t('runtimeStatus.logs')}: ${status.logPath}`,
    `${t('runtimeStatus.database')}: ${status.dbPath}`,
  ].join('\n')

  return (
    <section
      aria-label={t('runtimeStatus.title')}
      className="mx-2 mb-2 rounded border px-2 py-2 text-xs text-ter"
      data-testid="runtime-status-strip"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-1)' }}
      title={title}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-sec">
        <Server size={13} aria-hidden />
        <span className="truncate font-medium">{t('runtimeStatus.title')}</span>
        <span className="mono ml-auto text-pri">{status.port}</span>
      </div>
      <div className="mono mt-1 flex min-w-0 items-center gap-2 text-[11px]">
        <span>{t('runtimeStatus.pid', { pid: status.pid })}</span>
        <span>v{status.version}</span>
      </div>
      <div className="mono mt-1 truncate text-[11px]">{fileName(status.logPath)}</div>
    </section>
  )
}
