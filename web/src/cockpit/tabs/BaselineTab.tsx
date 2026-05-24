import type { BaselineFile, ParsedBaseline } from '../../api.js'

const MarkdownPreview = ({ content }: { content: string }) => (
  <div className="space-y-2 text-sec text-sm leading-6">
    {content.split(/\r?\n/).map((line, index) => {
      const key = `${index}:${line}`
      if (line.startsWith('# '))
        return (
          <h3 className="font-semibold text-lg text-pri" key={key}>
            {line.slice(2)}
          </h3>
        )
      if (line.startsWith('## '))
        return (
          <h4 className="font-medium text-pri" key={key}>
            {line.slice(3)}
          </h4>
        )
      if (line.startsWith('- '))
        return (
          <p className="pl-3" key={key}>
            - {line.slice(2)}
          </p>
        )
      if (!line.trim()) return <div className="h-2" key={key} />
      return <p key={key}>{line}</p>
    })}
  </div>
)

const BaselineCard = ({ file }: { file: BaselineFile }) => (
  <div className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
    <div className="mb-1 flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="truncate font-medium text-pri text-sm">{file.title}</div>
        <div className="mono truncate text-ter text-xs">{file.filename}</div>
      </div>
      <div className="flex shrink-0 gap-1">
        {!file.exists ? (
          <span className="rounded border px-1.5 text-ter text-xs">missing</span>
        ) : null}
        {file.isStub ? <span className="rounded border px-1.5 text-warn text-xs">stub</span> : null}
      </div>
    </div>
    <div className="text-sec text-xs tabular-nums">{file.size} lines</div>
  </div>
)

export const BaselineTab = ({ baseline }: { baseline: ParsedBaseline }) => (
  <div className="scroll-y space-y-4 px-5 py-4">
    {baseline.staleHint ? (
      <div
        className="rounded border px-3 py-2 text-sm"
        style={{
          background: 'color-mix(in oklab, var(--status-yellow) 12%, transparent)',
          borderColor: 'color-mix(in oklab, var(--status-yellow) 35%, var(--border))',
          color: 'var(--status-yellow)',
        }}
      >
        {baseline.staleHint}
      </div>
    ) : null}
    {baseline.readme ? (
      <section className="rounded border p-4" style={{ borderColor: 'var(--border)' }}>
        <MarkdownPreview content={baseline.readme.raw} />
      </section>
    ) : (
      <p className="rounded border p-3 text-sec text-sm" style={{ borderColor: 'var(--border)' }}>
        No baseline README found.
      </p>
    )}
    <section>
      <h3 className="mb-2 font-medium text-pri text-sm">Baseline files</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {baseline.children.map((file) => (
          <BaselineCard file={file} key={file.filename} />
        ))}
      </div>
    </section>
  </div>
)
