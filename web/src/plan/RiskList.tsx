import { AlertTriangle } from 'lucide-react'

import { useI18n } from '../i18n.js'

export const RiskList = ({ risks }: { risks: string[] }) => {
  const { t } = useI18n()
  if (!risks.length) return null
  return (
    <section className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
      <h3 className="mb-3 flex items-center gap-2 font-medium text-pri text-sm">
        <AlertTriangle size={14} aria-hidden />
        {t('plan.risk.title')}
      </h3>
      <ul className="space-y-2 text-sec text-sm">
        {risks.map((risk) => (
          <li className="flex gap-2" key={risk}>
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: 'var(--status-red)' }}
            />
            <span>{risk}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
