import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type PMDecisionStatus = 'draft' | 'adopted' | 'superseded'

export interface PMDecision {
  date: string
  filename: string
  raw: string
  slug: string
  status: PMDecisionStatus
  title: string
}

export interface ParsedDecisions {
  adopted: PMDecision[]
  drafts: PMDecision[]
  parseError: string | null
}

const titleFromMarkdown = (content: string, fallback: string) =>
  /^#\s+(.+?)\s*$/m.exec(content)?.[1]?.trim() ?? fallback

const statusFromContent = (filename: string, content: string): PMDecisionStatus => {
  if (filename.startsWith('draft-')) return 'draft'
  const statusMatch = /(?:\*\*状态\*\*|status)\s*[:：]\s*(.+)/i.exec(content)
  const status = statusMatch?.[1]?.toLowerCase() ?? ''
  if (/draft|提案|草稿/.test(status)) return 'draft'
  if (/superseded|废弃|取代/.test(status)) return 'superseded'
  return 'adopted'
}

const parseDecisionFilename = (filename: string) => {
  const match = /^(?:draft-)?(?<date>\d{4}-\d{2}-\d{2})-(?<slug>.+)\.md$/.exec(filename)
  return {
    date: match?.groups?.date ?? '',
    slug: match?.groups?.slug ?? filename.replace(/\.md$/, ''),
  }
}

export const parseDecisionsDoc = (decisionsDir: string): ParsedDecisions => {
  const parsed: ParsedDecisions = { adopted: [], drafts: [], parseError: null }
  try {
    if (!existsSync(decisionsDir)) return parsed
    for (const filename of readdirSync(decisionsDir).sort().reverse()) {
      if (!filename.endsWith('.md') || filename === 'README.md') continue
      const raw = readFileSync(join(decisionsDir, filename), 'utf8')
      const fileInfo = parseDecisionFilename(filename)
      const decision: PMDecision = {
        date: fileInfo.date,
        filename,
        raw,
        slug: fileInfo.slug,
        status: statusFromContent(filename, raw),
        title: titleFromMarkdown(raw, fileInfo.slug),
      }
      if (decision.status === 'draft') parsed.drafts.push(decision)
      else parsed.adopted.push(decision)
    }
  } catch (error) {
    parsed.parseError = error instanceof Error ? error.message : String(error)
  }
  return parsed
}
