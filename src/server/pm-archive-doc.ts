import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface ArchivedMonth {
  fileCount: number
  files: string[]
  month: string
}

export interface ParsedArchive {
  months: ArchivedMonth[]
  parseError: string | null
}

export const parseArchiveDoc = (archiveDir: string): ParsedArchive => {
  const parsed: ParsedArchive = { months: [], parseError: null }
  try {
    if (!existsSync(archiveDir)) return parsed
    parsed.months = readdirSync(archiveDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name))
      .map((entry) => {
        const files = readdirSync(join(archiveDir, entry.name))
          .filter((filename) => !filename.startsWith('.'))
          .sort()
        return { fileCount: files.length, files, month: entry.name }
      })
      .sort((left, right) => right.month.localeCompare(left.month))
  } catch (error) {
    parsed.parseError = error instanceof Error ? error.message : String(error)
  }
  return parsed
}
