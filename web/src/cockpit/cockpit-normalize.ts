// Runtime normalizers for Cockpit / Plan payloads. The WS/HTTP layer only
// JSON.parse + TS-casts these, so a missing or stale-shape payload would let the
// render layer hard-access (questions.high.length, archive.months.length, …) and
// throw — which, pre-ErrorBoundary, white-screened the whole app. These functions
// guarantee every container the UI reads is present with a safe default, so an
// incomplete payload degrades to empty sections instead of crashing.
//
// Type-only imports (erased at build) — no runtime cycle with api.ts.
import type {
  ArchivedMonth,
  ParsedCockpit,
  ParsedPlan,
  PMTaskItem,
  PMTaskSection,
  PMTaskSubsection,
} from '../api.js'

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asObject = (value: unknown): Record<string, unknown> => (isObject(value) ? value : {})
const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])
const asString = (value: unknown): string => (typeof value === 'string' ? value : '')
const asStringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const asFiniteNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0
const asBoolean = (value: unknown): boolean => value === true
const asStringArray = (value: unknown): string[] =>
  asArray<unknown>(value).filter((item): item is string => typeof item === 'string')

// --- Nested element normalizers ---------------------------------------------
// The render layer also hard-accesses element fields (month.files.map,
// section.items.length, section.subsections.map, subsection.items.map). A stale
// payload like { months: [{ month: 'x' }] } would leave files undefined and throw,
// so every element is rebuilt with safe defaults too — not just the top arrays.

const normalizeArchiveMonth = (raw: unknown): ArchivedMonth => {
  const month = asObject(raw)
  return {
    fileCount: asFiniteNumber(month.fileCount),
    files: asStringArray(month.files),
    month: asString(month.month),
  }
}

const normalizeTaskItem = (raw: unknown): PMTaskItem => {
  const item = asObject(raw)
  return {
    done: asBoolean(item.done),
    raw: asString(item.raw),
    text: asString(item.text),
  }
}

const normalizeTaskSubsection = (raw: unknown): PMTaskSubsection => {
  const subsection = asObject(raw)
  return {
    doneCount: asFiniteNumber(subsection.doneCount),
    items: asArray(subsection.items).map(normalizeTaskItem),
    openCount: asFiniteNumber(subsection.openCount),
    title: asString(subsection.title),
    totalCount: asFiniteNumber(subsection.totalCount),
  }
}

const normalizeTaskSection = (raw: unknown): PMTaskSection => {
  const section = asObject(raw)
  return {
    doneCount: asFiniteNumber(section.doneCount),
    items: asArray(section.items).map(normalizeTaskItem),
    key: section.key as PMTaskSection['key'],
    openCount: asFiniteNumber(section.openCount),
    subsections: asArray(section.subsections).map(normalizeTaskSubsection),
    title: asString(section.title),
    totalCount: asFiniteNumber(section.totalCount),
  }
}

const normalizeScope = (value: unknown): ParsedPlan['scope'] => {
  if (!isObject(value)) return null
  return { in: asStringArray(value.in), out: asStringArray(value.out) }
}

export const normalizePlan = (raw: unknown): ParsedPlan => {
  const plan = asObject(raw)
  return {
    currentPhase: asStringOrNull(plan.currentPhase),
    frontmatter: asObject(plan.frontmatter) as ParsedPlan['frontmatter'],
    goal: asStringOrNull(plan.goal),
    milestones: asArray(plan.milestones),
    parseError: asStringOrNull(plan.parseError),
    raw: asString(plan.raw),
    risks: asStringArray(plan.risks),
    scope: normalizeScope(plan.scope),
  }
}

export const normalizeCockpit = (raw: unknown): ParsedCockpit => {
  const cockpit = asObject(raw)
  const archive = asObject(cockpit.archive)
  const baseline = asObject(cockpit.baseline)
  const decisions = asObject(cockpit.decisions)
  const ideas = asObject(cockpit.ideas)
  const questions = asObject(cockpit.questions)
  const research = asObject(cockpit.research)
  const reports = asObject(cockpit.reports)
  const tasks = asObject(cockpit.tasks)
  const readme = baseline.readme
  return {
    aiActions: asArray(cockpit.aiActions),
    archive: {
      months: asArray(archive.months).map(normalizeArchiveMonth),
      parseError: asStringOrNull(archive.parseError),
    },
    baseline: {
      children: asArray(baseline.children),
      parseError: asStringOrNull(baseline.parseError),
      readme: isObject(readme)
        ? { raw: asString(readme.raw), title: asString(readme.title) }
        : null,
      staleHint: asStringOrNull(baseline.staleHint),
    },
    decisions: {
      adopted: asArray(decisions.adopted),
      drafts: asArray(decisions.drafts),
      parseError: asStringOrNull(decisions.parseError),
    },
    generatedAt: asFiniteNumber(cockpit.generatedAt),
    ideas: {
      inbox: asArray(ideas.inbox),
      parseError: asStringOrNull(ideas.parseError),
      promoted: asArray(ideas.promoted),
      raw: asString(ideas.raw),
    },
    plan: normalizePlan(cockpit.plan),
    questions: {
      answered: asArray(questions.answered),
      high: asArray(questions.high),
      low: asArray(questions.low),
      medium: asArray(questions.medium),
      parseError: asStringOrNull(questions.parseError),
      raw: asString(questions.raw),
    },
    reports: {
      entries: asArray(reports.entries),
      parseError: asStringOrNull(reports.parseError),
      totalCount: asFiniteNumber(reports.totalCount),
    },
    research: {
      entries: asArray(research.entries),
      parseError: asStringOrNull(research.parseError),
      totalCount: asFiniteNumber(research.totalCount),
    },
    tasks: {
      parseError: asStringOrNull(tasks.parseError),
      raw: asString(tasks.raw),
      sections: asArray(tasks.sections).map(normalizeTaskSection),
      totalDone: asFiniteNumber(tasks.totalDone),
      totalOpen: asFiniteNumber(tasks.totalOpen),
    },
  }
}
