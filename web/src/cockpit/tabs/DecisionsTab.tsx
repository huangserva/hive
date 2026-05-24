import type { ParsedDecisions, PMDecision } from '../../api.js'

const DecisionRow = ({ decision, draft }: { decision: PMDecision; draft?: boolean }) => (
  <div className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
    <div className="mb-1 flex items-center gap-2 text-ter text-xs">
      {decision.date ? <span>{decision.date}</span> : null}
      <span className="mono truncate">{decision.slug}</span>
      <span className="rounded border px-1.5">{decision.status}</span>
    </div>
    <div className="flex items-start gap-3">
      <p className="min-w-0 flex-1 font-medium text-pri text-sm">{decision.title}</p>
      {draft ? (
        <button
          className="shrink-0 cursor-pointer rounded px-2 py-1 text-accent text-xs hover:bg-3"
          onClick={() => {
            // TODO: wire decision confirmation POST in Phase C-2.5.
          }}
          type="button"
        >
          确认归档
        </button>
      ) : null}
    </div>
  </div>
)

export const DecisionsTab = ({ decisions }: { decisions: ParsedDecisions }) => (
  <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden px-5 py-4 lg:grid-cols-2">
    <section className="min-h-0 scroll-y">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium text-pri text-sm">Drafts</h3>
        <span className="text-ter text-xs tabular-nums">{decisions.drafts.length}</span>
      </div>
      <div className="space-y-2">
        {decisions.drafts.length ? (
          decisions.drafts.map((decision) => (
            <DecisionRow decision={decision} draft key={decision.filename} />
          ))
        ) : (
          <p
            className="rounded border p-3 text-sec text-sm"
            style={{ borderColor: 'var(--border)' }}
          >
            No draft decisions.
          </p>
        )}
      </div>
    </section>
    <section className="min-h-0 scroll-y">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium text-pri text-sm">Adopted</h3>
        <span className="text-ter text-xs tabular-nums">{decisions.adopted.length}</span>
      </div>
      <div className="space-y-2">
        {decisions.adopted.length ? (
          decisions.adopted.map((decision) => (
            <DecisionRow decision={decision} key={decision.filename} />
          ))
        ) : (
          <p
            className="rounded border p-3 text-sec text-sm"
            style={{ borderColor: 'var(--border)' }}
          >
            No adopted decisions.
          </p>
        )}
      </div>
    </section>
  </div>
)
