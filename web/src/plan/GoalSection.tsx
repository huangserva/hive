import { useI18n } from '../i18n.js'

export const GoalSection = ({ goal }: { goal: string | null }) => {
  const { t } = useI18n()
  if (!goal) return null
  return (
    <section className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
      <h3 className="mb-2 font-medium text-pri text-sm">{t('plan.goal.title')}</h3>
      <p className="whitespace-pre-wrap text-sec text-sm leading-6">{goal}</p>
    </section>
  )
}
