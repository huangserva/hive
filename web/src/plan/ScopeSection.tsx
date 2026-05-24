import type { ParsedPlan } from '../api.js'

const ScopeColumn = ({ items, title }: { items: string[]; title: string }) => (
  <div className="min-w-0">
    <h4 className="mb-2 font-medium text-pri text-xs uppercase tracking-wide">{title}</h4>
    {items.length ? (
      <ul className="space-y-1 text-sec text-sm">
        {items.map((item) => (
          <li className="flex gap-2" key={item}>
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ter" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-ter text-sm">-</p>
    )}
  </div>
)

export const ScopeSection = ({ scope }: { scope: ParsedPlan['scope'] }) => {
  if (!scope) return null
  return (
    <section className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
      <h3 className="mb-3 font-medium text-pri text-sm">Scope</h3>
      <div className="grid grid-cols-2 gap-4">
        <ScopeColumn items={scope.in} title="In" />
        <ScopeColumn items={scope.out} title="Out" />
      </div>
    </section>
  )
}
