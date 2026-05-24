import type { ParsedIdeas, PMIdea } from '../../api.js'

const IdeaRow = ({ idea, promoted }: { idea: PMIdea; promoted?: boolean }) => (
  <div className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
    <div className="mb-1 flex items-center gap-2 text-ter text-xs">
      <span className="mono">{idea.id}</span>
      {idea.addedAt ? <span>{idea.addedAt}</span> : null}
      {promoted ? <span>promoted</span> : null}
    </div>
    <div className="flex items-start gap-3">
      <p className="min-w-0 flex-1 text-sec text-sm leading-5">{idea.text}</p>
      {!promoted ? (
        <button
          className="shrink-0 cursor-pointer rounded px-2 py-1 text-accent text-xs hover:bg-3"
          onClick={() => {
            // TODO: wire promote POST in Phase C-2.5.
          }}
          type="button"
        >
          Promote
        </button>
      ) : null}
    </div>
  </div>
)

export const IdeasTab = ({ ideas }: { ideas: ParsedIdeas }) => (
  <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden px-5 py-4 lg:grid-cols-2">
    <section className="min-h-0 scroll-y">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium text-pri text-sm">Inbox</h3>
        <span className="text-ter text-xs tabular-nums">{ideas.inbox.length}</span>
      </div>
      <div className="space-y-2">
        {ideas.inbox.length ? (
          ideas.inbox.map((idea) => <IdeaRow idea={idea} key={idea.id} />)
        ) : (
          <p
            className="rounded border p-3 text-sec text-sm"
            style={{ borderColor: 'var(--border)' }}
          >
            No inbox ideas.
          </p>
        )}
      </div>
    </section>
    <section className="min-h-0 scroll-y">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium text-pri text-sm">Promoted</h3>
        <span className="text-ter text-xs tabular-nums">{ideas.promoted.length}</span>
      </div>
      <div className="space-y-2">
        {ideas.promoted.length ? (
          ideas.promoted.map((idea) => <IdeaRow idea={idea} key={idea.id} promoted />)
        ) : (
          <p
            className="rounded border p-3 text-sec text-sm"
            style={{ borderColor: 'var(--border)' }}
          >
            No promoted ideas.
          </p>
        )}
      </div>
    </section>
  </div>
)
