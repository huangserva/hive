import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DONE_LINES_THRESHOLD = 200
const REPORTS_THRESHOLD = 20
const RESEARCH_THRESHOLD = 15

export type ArchiveAuditKind = 'tasks-done' | 'reports-count' | 'research-count'

export interface ArchiveAuditFinding {
  archiveMonth: string
  kind: ArchiveAuditKind
  message: string
}

export interface ArchiveAuditTriggerOptions {
  now?: () => Date
}

const archiveMonthFor = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`

const countFilesWithExtension = (directory: string, extension: string) => {
  if (!existsSync(directory)) return 0
  return readdirSync(directory, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && entry.name.endsWith(extension)
  ).length
}

const countDoneSectionLines = (tasksPath: string) => {
  if (!existsSync(tasksPath)) return 0
  const lines = readFileSync(tasksPath, 'utf8').split(/\r?\n/)
  const doneIndex = lines.findIndex((line) => line.trim() === '## Done')
  if (doneIndex === -1) return 0
  const nextSectionIndex = lines.findIndex(
    (line, index) => index > doneIndex && line.startsWith('## ')
  )
  const doneLines = lines.slice(
    doneIndex + 1,
    nextSectionIndex === -1 ? undefined : nextSectionIndex
  )
  return doneLines.filter((line) => line.trim().length > 0).length
}

export const inspectArchiveAudit = (
  workspacePath: string,
  now = new Date()
): ArchiveAuditFinding[] => {
  const hiveDir = join(workspacePath, '.hive')
  const archiveMonth = archiveMonthFor(now)
  const findings: ArchiveAuditFinding[] = []
  const doneLines = countDoneSectionLines(join(hiveDir, 'tasks.md'))
  if (doneLines > DONE_LINES_THRESHOLD) {
    findings.push({
      archiveMonth,
      kind: 'tasks-done',
      message: `tasks.md Done 段已 ${doneLines} 行，建议归档到 .hive/archive/${archiveMonth}/`,
    })
  }

  const reportsCount = countFilesWithExtension(join(hiveDir, 'reports'), '.html')
  if (reportsCount > REPORTS_THRESHOLD) {
    findings.push({
      archiveMonth,
      kind: 'reports-count',
      message: `reports/ 目录已有 ${reportsCount} 个 HTML，建议归档旧报告到 .hive/archive/${archiveMonth}/`,
    })
  }

  const researchCount = countFilesWithExtension(join(hiveDir, 'research'), '.md')
  if (researchCount > RESEARCH_THRESHOLD) {
    findings.push({
      archiveMonth,
      kind: 'research-count',
      message: `research/ 目录已有 ${researchCount} 个笔记，建议归档旧笔记到 .hive/archive/${archiveMonth}/`,
    })
  }

  return findings
}

export const createArchiveAuditTrigger = ({
  now = () => new Date(),
}: ArchiveAuditTriggerOptions = {}) => {
  const triggeredMonths = new Set<string>()

  const check = (workspacePath: string) => {
    const checkedAt = now()
    const archiveMonth = archiveMonthFor(checkedAt)
    const key = `${workspacePath}:${archiveMonth}`
    if (triggeredMonths.has(key)) return []
    const findings = inspectArchiveAudit(workspacePath, checkedAt)
    if (findings.length > 0) triggeredMonths.add(key)
    return findings
  }

  return { check }
}
