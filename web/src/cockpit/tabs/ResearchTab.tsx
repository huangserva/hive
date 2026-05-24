import type { ParsedResearch, PMResearchEntry } from '../../api.js'

const ResearchEntryCard = ({ entry }: { entry: PMResearchEntry }) => (
  <div className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
    <div className="mb-1 flex items-center gap-2 text-ter text-xs">
      {entry.date ? <span>{entry.date}</span> : null}
      <span className="mono truncate">{entry.filename}</span>
      <span className="tabular-nums">{entry.size} lines</span>
    </div>
    <div className="font-medium text-pri text-sm">{entry.title}</div>
    <div className="mt-1 text-sec text-xs">{entry.topic}</div>
  </div>
)

export const ResearchTab = ({ research }: { research: ParsedResearch }) => (
  <div className="scroll-y space-y-4 px-5 py-4">
    <div className="flex items-center justify-between">
      <h3 className="font-medium text-pri text-sm">Research notes</h3>
      <span className="text-ter text-xs tabular-nums">{research.totalCount}</span>
    </div>
    {research.parseError ? (
      <div
        className="rounded border px-3 py-2 text-sm text-warn"
        style={{ borderColor: 'var(--border)' }}
      >
        research parse warning: {research.parseError}
      </div>
    ) : null}
    <div className="space-y-2">
      {research.entries.length ? (
        research.entries.map((entry) => <ResearchEntryCard entry={entry} key={entry.filename} />)
      ) : (
        <p className="rounded border p-3 text-sec text-sm" style={{ borderColor: 'var(--border)' }}>
          No research notes in .hive/research yet.
        </p>
      )}
    </div>
  </div>
)
