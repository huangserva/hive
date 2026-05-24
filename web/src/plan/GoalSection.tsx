export const GoalSection = ({ goal }: { goal: string | null }) => {
  if (!goal) return null
  return (
    <section className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
      <h3 className="mb-2 font-medium text-pri text-sm">目标</h3>
      <p className="whitespace-pre-wrap text-sec text-sm leading-6">{goal}</p>
    </section>
  )
}
