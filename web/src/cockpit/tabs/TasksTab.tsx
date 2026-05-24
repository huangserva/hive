import type { ParsedTasks, PMTaskSection, PMTaskSubsection } from '../../api.js'

const completionPercent = (done: number, open: number) => {
  const total = done + open
  return total === 0 ? 0 : Math.round((done / total) * 100)
}

const ProgressBar = ({ done, open }: { done: number; open: number }) => {
  const percent = completionPercent(done, open)
  return (
    <div
      aria-label="Tasks progress"
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={percent}
      className="h-1.5 overflow-hidden rounded-full"
      role="progressbar"
      style={{ background: 'var(--bg-3)' }}
    >
      <span
        className="block h-full rounded-full"
        style={{ background: 'var(--accent)', width: `${percent}%` }}
      />
    </div>
  )
}

const TaskLines = ({ items }: { items: PMTaskSubsection['items'] }) =>
  items.length ? (
    <div className="space-y-1.5">
      {items.map((item) => (
        <div className="flex gap-2 text-sm" key={item.raw}>
          <span className={item.done ? 'text-accent' : 'text-ter'}>
            {item.done ? '[x]' : '[ ]'}
          </span>
          <span className={item.done ? 'text-ter line-through' : 'text-sec'}>{item.text}</span>
        </div>
      ))}
    </div>
  ) : null

const SubsectionBlock = ({ subsection }: { subsection: PMTaskSubsection }) => (
  <div className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
    <div className="mb-2 flex items-center justify-between gap-2">
      <h4 className="font-medium text-pri text-sm">{subsection.title}</h4>
      <span className="text-ter text-xs tabular-nums">
        {subsection.doneCount}/{subsection.totalCount}
      </span>
    </div>
    <TaskLines items={subsection.items} />
  </div>
)

const SectionBlock = ({ section }: { section: PMTaskSection }) => (
  <section className="rounded border p-3" style={{ borderColor: 'var(--border)' }}>
    <div className="mb-3 flex items-start justify-between gap-3">
      <div>
        <h3 className="font-medium text-pri text-sm">{section.title}</h3>
        <div className="mt-1 text-ter text-xs tabular-nums">
          {section.openCount} open · {section.doneCount} done
        </div>
      </div>
      <span className="text-ter text-xs tabular-nums">
        {completionPercent(section.doneCount, section.openCount)}%
      </span>
    </div>
    <ProgressBar done={section.doneCount} open={section.openCount} />
    <div className="mt-3 space-y-2">
      <TaskLines items={section.items} />
      {section.subsections.map((subsection) => (
        <SubsectionBlock key={subsection.title} subsection={subsection} />
      ))}
    </div>
  </section>
)

export const TasksTab = ({ tasks }: { tasks: ParsedTasks }) => (
  <div className="scroll-y space-y-4 px-5 py-4">
    <section className="rounded border p-4" style={{ borderColor: 'var(--border)' }}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-pri text-sm">Tasks</h2>
        <span className="text-ter text-xs tabular-nums">
          {tasks.totalDone}/{tasks.totalDone + tasks.totalOpen}
        </span>
      </div>
      <ProgressBar done={tasks.totalDone} open={tasks.totalOpen} />
    </section>
    {tasks.parseError ? (
      <div
        className="rounded border px-3 py-2 text-sm text-warn"
        style={{ borderColor: 'var(--border)' }}
      >
        tasks.md parse warning: {tasks.parseError}
      </div>
    ) : null}
    {tasks.sections.length ? (
      tasks.sections.map((section) => <SectionBlock key={section.title} section={section} />)
    ) : (
      <p className="rounded border p-3 text-sec text-sm" style={{ borderColor: 'var(--border)' }}>
        No task sections parsed from .hive/tasks.md.
      </p>
    )}
  </div>
)
