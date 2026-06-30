import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { readCachedTextFile } from './pm-file-cache.js'

export interface PMReportEntry {
  date: string
  filename: string
  mtime: string
  path: string
  size: number
  title: string
  topic: string
}

export interface ParsedReports {
  entries: PMReportEntry[]
  parseError: string | null
  totalCount: number
}

const REPORT_DATE_PATTERN = /\d{4}-\d{2}-\d{2}/

const lineCount = (content: string) => (content ? content.split(/\r?\n/).length : 0)

const stripDate = (stem: string, date: string) =>
  stem
    .replace(date, '')
    .replace(/^[-_]+|[-_]+$/g, '')
    .replace(/[-_]+/g, ' ')
    .trim()

const parseFilename = (filename: string) => {
  const base = filename.replace(/\.html$/i, '')
  const date = REPORT_DATE_PATTERN.exec(base)?.[0] ?? ''
  return {
    date,
    topic: (date ? stripDate(base, date) : base.replace(/[-_]+/g, ' ')).trim(),
  }
}

const titleFromHtml = (content: string, fallback: string) => {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(content)?.[1]?.trim()
  return title ? title.replace(/\s+/g, ' ') : fallback
}

export const parseReportsDoc = (reportsDir: string): ParsedReports => {
  const parsed: ParsedReports = { entries: [], parseError: null, totalCount: 0 }
  try {
    if (!existsSync(reportsDir)) return parsed
    parsed.entries = readdirSync(reportsDir, { withFileTypes: true })
      .filter(
        (entry) => entry.isFile() && entry.name.endsWith('.html') && !entry.name.startsWith('.')
      )
      .map((entry) => {
        const filename = entry.name
        const filePath = join(reportsDir, filename)
        const raw = readCachedTextFile(filePath)
        const mtime = statSync(filePath).mtime.toISOString()
        const fileInfo = parseFilename(filename)
        const fallbackTitle = fileInfo.topic || filename.replace(/\.html$/i, '')
        return {
          date: fileInfo.date,
          filename,
          mtime,
          path: `.hive/reports/${filename}`,
          size: lineCount(raw),
          title: titleFromHtml(raw, fallbackTitle),
          topic: fileInfo.topic,
        }
      })
      .sort((left, right) => right.mtime.localeCompare(left.mtime))
    parsed.totalCount = parsed.entries.length
  } catch (error) {
    parsed.parseError = error instanceof Error ? error.message : String(error)
  }
  return parsed
}
