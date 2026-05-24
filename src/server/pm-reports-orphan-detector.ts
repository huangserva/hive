import { existsSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'

export interface OrphanReport {
  reportDate: string
  reportPath: string
  suggestedResearchPath: string
}

const REPORT_DATE_PATTERN = /\d{4}-\d{2}-\d{2}/
const IGNORED_REPORT_PATTERNS = [/setup-guide/i, /tutorial/i, /handoff/i]

const extractDate = (filename: string) => REPORT_DATE_PATTERN.exec(filename)?.[0] ?? null

const isIgnoredReport = (filename: string) =>
  IGNORED_REPORT_PATTERNS.some((pattern) => pattern.test(filename))

const stripDate = (stem: string, date: string) =>
  stem
    .replace(date, '')
    .replace(/^[-_]+|[-_]+$/g, '')
    .replace(/[-_]+/g, '-')

const suggestedResearchFilename = (reportFilename: string, reportDate: string) => {
  const stem = reportFilename.replace(/\.html$/i, '')
  const slug = stripDate(stem, reportDate) || 'research-note'
  return `${reportDate}-${slug}.md`
}

const listMarkdownFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.')) return []
    const entryPath = join(dir, entry.name)
    if (entry.isDirectory()) return listMarkdownFiles(entryPath)
    return entry.isFile() && entry.name.endsWith('.md') ? [entryPath] : []
  })

export const detectOrphanReports = (hiveDir: string): OrphanReport[] => {
  const reportsDir = join(hiveDir, 'reports')
  const researchDir = join(hiveDir, 'research')
  if (!existsSync(reportsDir)) return []

  const researchDates = new Set(
    existsSync(researchDir)
      ? listMarkdownFiles(researchDir)
          .map(extractDate)
          .filter((date): date is string => Boolean(date))
      : []
  )

  return readdirSync(reportsDir)
    .filter((filename) => filename.endsWith('.html') && !filename.startsWith('.'))
    .filter((filename) => !isIgnoredReport(filename))
    .flatMap((filename) => {
      const reportDate = extractDate(filename)
      if (!reportDate || researchDates.has(reportDate)) return []
      return [
        {
          reportDate,
          reportPath: join(reportsDir, filename),
          suggestedResearchPath: join(
            researchDir,
            suggestedResearchFilename(basename(filename), reportDate)
          ),
        },
      ]
    })
}
