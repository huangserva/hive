export type PlanMarkdownSegment = {
  kind: 'bold' | 'code' | 'text'
  text: string
}

export type PlanMarkdownBlock = {
  kind: 'listItem' | 'paragraph' | 'quote'
  segments: PlanMarkdownSegment[]
}

export type PlanMilestoneDetails = {
  markdown: string
  subtitle: string
}

const inlineTokenPattern = /(\*\*([^*]+?)\*\*|`([^`]+?)`)/gu

const normalizeWikiLinks = (value: string) => value.replace(/\[\[([^\]]+?)\]\]/gu, '$1')

export const extractPlanMilestoneDetails = (body: string): PlanMilestoneDetails => {
  const lines = body
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false
      if (/^- \[[ xX]\]/u.test(line)) return false
      if (/^#{1,6}\s+/u.test(line)) return false
      if (/^```/u.test(line)) return false
      return true
    })
    .map((line) => line.replace(/\[(.+?)\]\(.+?\)/gu, '$1').replace(/\[\[(.+?)\]\]/gu, '$1'))

  return {
    markdown: lines.join('\n'),
    subtitle: lines.slice(0, 2).join(' '),
  }
}

export const parsePlanMarkdownInline = (value: string): PlanMarkdownSegment[] => {
  const normalized = normalizeWikiLinks(value)
  const segments: PlanMarkdownSegment[] = []
  let cursor = 0

  for (const match of normalized.matchAll(inlineTokenPattern)) {
    const index = match.index ?? 0
    if (index > cursor) {
      segments.push({ kind: 'text', text: normalized.slice(cursor, index) })
    }
    if (match[2] !== undefined) {
      segments.push({ kind: 'bold', text: match[2] })
    } else if (match[3] !== undefined) {
      segments.push({ kind: 'code', text: match[3] })
    }
    cursor = index + match[0].length
  }

  if (cursor < normalized.length) {
    segments.push({ kind: 'text', text: normalized.slice(cursor) })
  }

  return segments.length > 0 ? segments : [{ kind: 'text', text: normalized }]
}

export const parsePlanMarkdownBlocks = (value: string): PlanMarkdownBlock[] =>
  value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.startsWith('> ')) {
        return { kind: 'quote', segments: parsePlanMarkdownInline(line.slice(2).trim()) }
      }
      if (line.startsWith('- ')) {
        return { kind: 'listItem', segments: parsePlanMarkdownInline(line.slice(2).trim()) }
      }
      return { kind: 'paragraph', segments: parsePlanMarkdownInline(line) }
    })
