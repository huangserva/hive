import type { ParsedArchive } from '../../api.js'
import { useI18n } from '../../i18n.js'

export const ArchiveTab = ({ archive }: { archive: ParsedArchive }) => {
  const { t } = useI18n()
  return (
    <div className="scroll-y space-y-3 px-5 py-4">
      {archive.months.length ? (
        archive.months.map((month) => (
          <details
            className="rounded border"
            key={month.month}
            open
            style={{ borderColor: 'var(--border)' }}
          >
            <summary className="cursor-pointer px-3 py-2 font-medium text-pri text-sm">
              {month.month}
              <span className="ml-2 text-ter text-xs tabular-nums">
                {t('cockpit.archive.files', { count: month.fileCount })}
              </span>
            </summary>
            <div className="space-y-1 px-3 pb-3">
              {month.files.map((file) => (
                <div className="mono rounded bg-2 px-2 py-1.5 text-sec text-xs" key={file}>
                  {file}
                </div>
              ))}
            </div>
          </details>
        ))
      ) : (
        <p className="rounded border p-3 text-sec text-sm" style={{ borderColor: 'var(--border)' }}>
          {t('cockpit.archive.empty')}
        </p>
      )}
    </div>
  )
}
