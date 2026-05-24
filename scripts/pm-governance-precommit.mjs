#!/usr/bin/env node
import { execFileSync } from 'node:child_process'

const DATE_PATTERN = /\d{4}-\d{2}-\d{2}/
const IGNORED_REPORT_PATTERNS = [/setup-guide/i, /tutorial/i, /handoff/i]

const normalizePath = (file) => file.replaceAll('\\', '/')

const dateFromPath = (file) => DATE_PATTERN.exec(file)?.[0] ?? null

const isReportHtml = (file) =>
  file.startsWith('.hive/reports/') && file.toLowerCase().endsWith('.html')

const isResearchNote = (file) =>
  file.startsWith('.hive/research/') && file.toLowerCase().endsWith('.md')

const isIgnoredReport = (file) => IGNORED_REPORT_PATTERNS.some((pattern) => pattern.test(file))

export const evaluateStagedPmGovernance = (files) => {
  const staged = files.map(normalizePath)
  const warnings = []
  const errors = []
  const researchDates = new Set(staged.filter(isResearchNote).map(dateFromPath).filter(Boolean))

  for (const report of staged.filter(isReportHtml).filter((file) => !isIgnoredReport(file))) {
    const reportDate = dateFromPath(report)
    if (!reportDate || researchDates.has(reportDate)) continue
    errors.push(
      `${report} is staged without a same-day .hive/research/${reportDate}-*.md note. Research-class work must commit reports/ + research/ together.`
    )
  }

  if (staged.includes('.hive/plan.md')) {
    warnings.push(
      '.hive/plan.md is staged; milestone status edits should include the relevant commit hash once available.'
    )
  }

  return { errors, warnings }
}

const readStagedFiles = () =>
  execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMRT'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

const main = () => {
  const result = evaluateStagedPmGovernance(readStagedFiles())
  for (const warning of result.warnings) {
    console.error(`[pm-governance warning] ${warning}`)
  }
  if (result.errors.length === 0) return
  for (const error of result.errors) {
    console.error(`[pm-governance error] ${error}`)
  }
  process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
