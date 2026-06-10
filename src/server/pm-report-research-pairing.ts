import { existsSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'

export interface PmReportCandidate {
  content?: string
  filename: string
  path?: string
}

export interface PmResearchCandidate {
  filename: string
  path?: string
}

const DATE_PATTERN = /\d{4}-\d{2}-\d{2}/
const ALL_DATE_PATTERN = /\d{4}-\d{2}-\d{2}/g
const RESEARCH_REFERENCE_RE = /(?:\.hive\/research|(?:^|[./])research)\/([^"'<>\s)]+\.md)\b/giu
const IGNORED_REPORT_TOPIC_TOKENS = new Set([
  'boss',
  'deck',
  'handoff',
  'mockup',
  'plan',
  'setup',
  'tutorial',
  'view',
])
const PAIRING_STOP_TOKENS = new Set(['html', 'md', 'note', 'report', 'research', 'v'])

export const extractPmDocDate = (filename: string) => DATE_PATTERN.exec(filename)?.[0] ?? null

export const normalizePmDocTopic = (filename: string) =>
  basename(filename)
    .replace(/\.[^.]+$/u, '')
    .toLowerCase()
    .replace(ALL_DATE_PATTERN, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, '-')
    .replace(/^-+|-+$/gu, '')

const stripDate = (stem: string, date: string) =>
  stem
    .replace(date, '')
    .replace(/^[-_]+|[-_]+$/g, '')
    .replace(/[-_]+/g, '-')

export const suggestedResearchFilename = (reportFilename: string, reportDate: string) => {
  const stem = reportFilename.replace(/\.html$/i, '')
  const slug = stripDate(stem, reportDate) || 'research-note'
  return `${reportDate}-${slug}.md`
}

const tokenizeTopic = (topic: string) =>
  topic
    .split('-')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !PAIRING_STOP_TOKENS.has(token))

export const shouldIgnoreReportResearchPairing = (filename: string) => {
  const topicTokens = new Set(tokenizeTopic(normalizePmDocTopic(filename)))
  if (topicTokens.has('setup') && topicTokens.has('guide')) return true
  if (topicTokens.has('boss') && topicTokens.has('view')) return true
  return [...topicTokens].some((token) => IGNORED_REPORT_TOPIC_TOKENS.has(token))
}

export const listPmResearchCandidates = (researchDir: string): PmResearchCandidate[] => {
  if (!existsSync(researchDir)) return []
  const listMarkdownFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.name.startsWith('.')) return []
      const entryPath = join(dir, entry.name)
      if (entry.isDirectory()) return listMarkdownFiles(entryPath)
      return entry.isFile() && entry.name.toLowerCase().endsWith('.md') ? [entryPath] : []
    })

  return listMarkdownFiles(researchDir).map((path) => ({ filename: basename(path), path }))
}

const extractResearchReferenceFilenames = (content: string) => {
  const references = new Set<string>()
  for (const match of content.matchAll(RESEARCH_REFERENCE_RE)) {
    const reference = match[1]
    if (reference) references.add(basename(reference))
  }
  return references
}

const hasExplicitResearchReference = (
  report: PmReportCandidate,
  researchFiles: PmResearchCandidate[]
) => {
  if (!report.content) return false
  const referencedFilenames = extractResearchReferenceFilenames(report.content)
  if (referencedFilenames.size === 0) return false
  return researchFiles.some((research) => referencedFilenames.has(basename(research.filename)))
}

const hasTopicMatch = (reportTopic: string, researchTopic: string) =>
  Boolean(
    reportTopic &&
      researchTopic &&
      (reportTopic === researchTopic ||
        reportTopic.includes(researchTopic) ||
        researchTopic.includes(reportTopic))
  )

const hasSameDayTokenOverlap = (
  report: PmReportCandidate,
  reportTopic: string,
  research: PmResearchCandidate,
  researchTopic: string
) => {
  const reportDate = extractPmDocDate(report.filename)
  const researchDate = extractPmDocDate(research.filename)
  if (!reportDate || reportDate !== researchDate) return false

  const reportTokens = new Set(tokenizeTopic(reportTopic))
  const researchTokens = new Set(tokenizeTopic(researchTopic))
  if (reportTokens.size === 0 || researchTokens.size === 0) return false

  const overlapCount = [...reportTokens].filter((token) => researchTokens.has(token)).length
  const smallerTokenSetSize = Math.min(reportTokens.size, researchTokens.size)
  return (
    overlapCount >= Math.min(2, smallerTokenSetSize) && overlapCount / smallerTokenSetSize >= 0.5
  )
}

export const findPairedResearchNote = (
  report: PmReportCandidate,
  researchFiles: PmResearchCandidate[]
) => {
  if (shouldIgnoreReportResearchPairing(report.filename)) return { ignored: true } as const
  if (hasExplicitResearchReference(report, researchFiles))
    return { matchedBy: 'explicit_reference' } as const

  const reportTopic = normalizePmDocTopic(report.filename)
  for (const research of researchFiles) {
    const researchTopic = normalizePmDocTopic(research.filename)
    if (hasTopicMatch(reportTopic, researchTopic)) return { matchedBy: 'topic' } as const
  }

  for (const research of researchFiles) {
    const researchTopic = normalizePmDocTopic(research.filename)
    if (hasSameDayTokenOverlap(report, reportTopic, research, researchTopic)) {
      return { matchedBy: 'same_day_token_overlap' } as const
    }
  }

  return null
}
