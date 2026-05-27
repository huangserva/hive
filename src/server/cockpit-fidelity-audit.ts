import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { parseDecisionsDoc } from './pm-decisions-doc.js'
import { parseReportsDoc } from './pm-reports-doc.js'

export type CockpitFidelityFindingType =
  | 'report_not_parsed'
  | 'report_missing_research'
  | 'decision_not_parsed'
  | 'decision_format_warning'

export interface CockpitFidelityFinding {
  detail: string
  file: string
  type: CockpitFidelityFindingType
}

export interface CockpitFidelityFindings {
  checkedAt: number
  findings: CockpitFidelityFinding[]
}

const DATE_PATTERN = /\d{4}-\d{2}-\d{2}/g
const INLINE_DECISION_METADATA_RE = /^\s*\*\*(?:状态|日期)\*\*\s*[:：]/m
const YAML_FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/

const listFiles = (directory: string, predicate: (filename: string) => boolean) => {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => entry.name)
    .sort()
}

const normalizeTopic = (filename: string) =>
  basename(filename)
    .replace(/\.[^.]+$/u, '')
    .toLowerCase()
    .replace(DATE_PATTERN, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, '-')
    .replace(/^-+|-+$/gu, '')

const hasPairedResearchNote = (reportFilename: string, researchFiles: string[]) => {
  const reportTopic = normalizeTopic(reportFilename)
  if (!reportTopic) return false
  return researchFiles.some((researchFilename) => {
    const researchTopic = normalizeTopic(researchFilename)
    return (
      researchTopic === reportTopic ||
      researchTopic.includes(reportTopic) ||
      reportTopic.includes(researchTopic)
    )
  })
}

export const auditCockpitFidelity = (workspacePath: string): CockpitFidelityFindings => {
  const hiveDir = join(workspacePath, '.hive')
  const reportsDir = join(hiveDir, 'reports')
  const researchDir = join(hiveDir, 'research')
  const decisionsDir = join(hiveDir, 'decisions')
  const findings: CockpitFidelityFinding[] = []

  const reportFiles = listFiles(
    reportsDir,
    (filename) => !filename.startsWith('.') && filename.toLowerCase().endsWith('.html')
  )
  const parsedReportFiles = new Set(
    parseReportsDoc(reportsDir).entries.map((entry) => entry.filename)
  )
  for (const filename of reportFiles) {
    if (!parsedReportFiles.has(filename)) {
      findings.push({
        detail: `${filename} exists in .hive/reports but is absent from parseReportsDoc output.`,
        file: filename,
        type: 'report_not_parsed',
      })
    }
  }

  const researchFiles = listFiles(
    researchDir,
    (filename) => !filename.startsWith('.') && filename.toLowerCase().endsWith('.md')
  )
  for (const filename of reportFiles) {
    if (!hasPairedResearchNote(filename, researchFiles)) {
      findings.push({
        detail: `${filename} is missing paired research note in .hive/research.`,
        file: filename,
        type: 'report_missing_research',
      })
    }
  }

  const decisionFiles = listFiles(
    decisionsDir,
    (filename) =>
      !filename.startsWith('.') &&
      filename !== 'README.md' &&
      filename.toLowerCase().endsWith('.md')
  )
  const parsedDecisions = parseDecisionsDoc(decisionsDir)
  const parsedDecisionFiles = new Set(
    [...parsedDecisions.adopted, ...parsedDecisions.drafts].map((decision) => decision.filename)
  )
  for (const filename of decisionFiles) {
    if (!parsedDecisionFiles.has(filename)) {
      findings.push({
        detail: `${filename} exists in .hive/decisions but is absent from parseDecisionsDoc output.`,
        file: filename,
        type: 'decision_not_parsed',
      })
    }

    const raw = readFileSync(join(decisionsDir, filename), 'utf8')
    if (YAML_FRONTMATTER_RE.test(raw) && !INLINE_DECISION_METADATA_RE.test(raw)) {
      findings.push({
        detail: `${filename} uses YAML frontmatter without inline **状态** or **日期** metadata; Cockpit may parse it incorrectly.`,
        file: filename,
        type: 'decision_format_warning',
      })
    }
  }

  return { checkedAt: Date.now(), findings }
}
