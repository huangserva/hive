import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { ConflictError, NotFoundError } from './http-errors.js'

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
  const statusMatch = /(?:\*\*状态\*\*|status)\s*[:：]\s*(.+)/i.exec(content)
  const status = statusMatch?.[1]?.toLowerCase() ?? ''
  const looksDraft = /draft|提案|草稿/.test(status)
  // 内容里明确写了单一终态（已采纳 / 废弃）就以内容为准——即使文件仍叫 draft-（手动改状态没改名）。
  // 但要求状态行不同时含 draft 字样，避免命中模板未填时的 "提案中 / 已采纳 / 已废弃" 并列选项。
  if (!looksDraft) {
    if (/superseded|废弃|取代/.test(status)) return 'superseded'
    if (/已采纳|采纳|adopted|accepted/.test(status)) return 'adopted'
  }
  if (filename.startsWith('draft-')) return 'draft'
  if (looksDraft) return 'draft'
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

const today = () => new Date().toISOString().slice(0, 10)

const markAdopted = (content: string) => {
  const statusLine = /(\*\*状态\*\*\s*[:：]\s*)(.+)/.exec(content)
  const withStatus = statusLine
    ? content.replace(/(\*\*状态\*\*\s*[:：]\s*)(.+)/, '$1已采纳')
    : content.replace(/^(#\s+.+)$/m, `$1\n\n**状态**: 已采纳`)

  if (/\*\*确认日期\*\*\s*[:：]/.test(withStatus)) {
    return withStatus.replace(/(\*\*确认日期\*\*\s*[:：]\s*)(.+)/, `$1${today()}`)
  }
  return withStatus.replace(/(\*\*状态\*\*\s*[:：]\s*已采纳)/, `$1\n**确认日期**: ${today()}`)
}

export const confirmDecisionInFile = (workspacePath: string, decisionId: string) => {
  const filename = basename(decisionId)
  if (filename !== decisionId || !filename.endsWith('.md')) {
    throw new NotFoundError(`Decision not found: ${decisionId}`)
  }

  const decisionsDir = join(workspacePath, '.hive', 'decisions')
  const draftPath = join(decisionsDir, filename)
  if (!existsSync(draftPath)) throw new NotFoundError(`Decision not found: ${decisionId}`)

  const nextFilename = filename.startsWith('draft-') ? filename.slice('draft-'.length) : filename
  const nextPath = join(decisionsDir, nextFilename)
  if (nextPath !== draftPath && existsSync(nextPath)) {
    throw new ConflictError(`Decision already exists: ${nextFilename}`)
  }

  const nextContent = markAdopted(readFileSync(draftPath, 'utf8'))
  writeFileSync(draftPath, nextContent.endsWith('\n') ? nextContent : `${nextContent}\n`, 'utf8')
  if (nextPath !== draftPath) renameSync(draftPath, nextPath)
  return { filename: nextFilename }
}
