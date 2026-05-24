import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface PMResearchEntry {
  date: string
  filename: string
  mtime: string
  size: number
  title: string
  topic: string
}

export interface ParsedResearch {
  entries: PMResearchEntry[]
  parseError: string | null
  totalCount: number
}

const titleFromMarkdown = (content: string, fallback: string) =>
  /^#\s+(.+?)\s*$/m.exec(content)?.[1]?.trim() ?? fallback

const lineCount = (content: string) => (content ? content.split(/\r?\n/).length : 0)

const parseFilename = (filename: string) => {
  const base = filename.replace(/\.md$/, '')
  const match = /^(?<date>\d{4}-\d{2}-\d{2})[-_](?<topic>.+)$/.exec(base)
  return {
    date: match?.groups?.date ?? '',
    topic: (match?.groups?.topic ?? base).replace(/[-_]+/g, ' ').trim(),
  }
}

export const parseResearchDoc = (researchDir: string): ParsedResearch => {
  const parsed: ParsedResearch = { entries: [], parseError: null, totalCount: 0 }
  try {
    if (!existsSync(researchDir)) return parsed
    parsed.entries = readdirSync(researchDir)
      .filter((filename) => filename.endsWith('.md') && !filename.startsWith('.'))
      .map((filename) => {
        const filePath = join(researchDir, filename)
        const raw = readFileSync(filePath, 'utf8')
        const mtime = statSync(filePath).mtime.toISOString()
        const fileInfo = parseFilename(filename)
        return {
          date: fileInfo.date,
          filename,
          mtime,
          size: lineCount(raw),
          title: titleFromMarkdown(raw, fileInfo.topic || filename.replace(/\.md$/, '')),
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
