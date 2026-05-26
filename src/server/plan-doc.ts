export type PlanMilestoneStatus = 'shipped' | 'blocked' | 'proposed' | 'open' | 'in_progress'

export interface ParsedMilestone {
  id: string
  title: string
  status: PlanMilestoneStatus
  date?: string
  items: { text: string; done: boolean }[]
  doneCount: number
  totalCount: number
  progress: number
  body: string
}

export interface ParsedPlan {
  frontmatter: {
    title?: string
    started?: string
    current_phase?: string
    status?: string
    last_review?: string
    [key: string]: string | undefined
  }
  goal: string | null
  milestones: ParsedMilestone[]
  scope: { in: string[]; out: string[] } | null
  risks: string[]
  currentPhase: string | null
  raw: string
  parseError: string | null
}

interface MarkdownSection {
  title: string
  body: string
}

const EMPTY_PLAN = (content: string): ParsedPlan => ({
  currentPhase: null,
  frontmatter: {},
  goal: null,
  milestones: [],
  parseError: null,
  raw: content,
  risks: [],
  scope: null,
})

const stripFrontmatter = (content: string) => {
  if (!content.startsWith('---')) {
    return { body: content, frontmatter: {} as ParsedPlan['frontmatter'] }
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
  if (!match) {
    return { body: content, frontmatter: {} as ParsedPlan['frontmatter'] }
  }
  const frontmatter: ParsedPlan['frontmatter'] = {}
  const frontmatterBody = match[1] ?? ''
  for (const line of frontmatterBody.split(/\r?\n/)) {
    const keyValue = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim())
    if (!keyValue) continue
    const key = keyValue[1]
    if (!key) continue
    const value = keyValue[2] ?? ''
    frontmatter[key] = value.replace(/^['"]|['"]$/g, '').trim()
  }
  return { body: content.slice(match[0].length), frontmatter }
}

const splitSections = (body: string, depth: 2 | 3): MarkdownSection[] => {
  const marker = '#'.repeat(depth)
  const regex = new RegExp(`^${marker}\\s+(.+?)\\s*$`, 'gm')
  const sections: MarkdownSection[] = []
  const matches = Array.from(body.matchAll(regex))
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    if (!match) continue
    const next = matches[index + 1]
    const title = (match[1] ?? '').trim()
    sections.push({
      body: body.slice((match.index ?? 0) + match[0].length, next?.index ?? body.length).trim(),
      title,
    })
  }
  return sections
}

const findSection = (sections: MarkdownSection[], patterns: RegExp[]) =>
  sections.find((section) => patterns.some((pattern) => pattern.test(section.title)))

const parseStatus = (heading: string): PlanMilestoneStatus => {
  const lower = heading.toLowerCase()
  if (lower.includes('shipped')) return 'shipped'
  if (lower.includes('blocked')) return 'blocked'
  if (lower.includes('proposed')) return 'proposed'
  if (lower.includes('open')) return 'open'
  return 'in_progress'
}

const parseMilestoneHeading = (heading: string) => {
  const idMatch = /\b(M\d+[a-z]?)\b/i.exec(heading)
  const rawId = idMatch?.[1] ?? heading.split(/\s+/)[0] ?? 'M?'
  const id = rawId.replace(
    /^m(\d+)([a-z]?)$/i,
    (_match, digits: string, suffix: string) => `M${digits}${suffix.toLowerCase()}`
  )
  const status = parseStatus(heading)
  const date = /\b\d{4}-\d{2}-\d{2}\b/.exec(heading)?.[0]
  const titleParts = heading
    .split('·')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/\b(shipped|blocked|proposed|open)\b/i.test(part))
    .map((part, index) => (index === 0 ? part.replace(/\bM\d+[a-z]?\b/i, '').trim() : part))
    .filter(Boolean)
  return {
    date,
    id,
    status,
    title: titleParts.join(' · ') || heading.replace(/\bM\d+\b/i, '').trim() || id,
  }
}

const parseCheckboxItems = (body: string) =>
  body.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*-\s+\[([ xX])\]\s+(.+?)\s*$/.exec(line)
    if (!match) return []
    return [{ done: (match[1] ?? '').toLowerCase() === 'x', text: (match[2] ?? '').trim() }]
  })

const parseMilestones = (section: MarkdownSection | undefined): ParsedMilestone[] => {
  if (!section) return []
  return splitSections(section.body, 3).map((milestone) => {
    const heading = parseMilestoneHeading(milestone.title)
    const items = parseCheckboxItems(milestone.body)
    const doneCount = items.filter((item) => item.done).length
    const totalCount = items.length
    return {
      body: milestone.body,
      doneCount,
      id: heading.id,
      items,
      progress: totalCount === 0 ? 0 : doneCount / totalCount,
      status: heading.status,
      title: heading.title,
      totalCount,
      ...(heading.date ? { date: heading.date } : {}),
    }
  })
}

const parseScope = (section: MarkdownSection | undefined): ParsedPlan['scope'] => {
  if (!section) return null
  const scope = { in: [] as string[], out: [] as string[] }
  let mode: 'in' | 'out' | null = null
  for (const line of section.body.split(/\r?\n/)) {
    const trimmed = line.trim()
    const labelMatch = /^-?\s*(in|out):\s*(.*)$/i.exec(trimmed)
    if (labelMatch) {
      mode = (labelMatch[1] ?? '').toLowerCase() as 'in' | 'out'
      const value = (labelMatch[2] ?? '').trim()
      if (value) scope[mode].push(value)
      continue
    }
    const bullet = /^-\s+(.+)$/.exec(trimmed)
    if (bullet && mode) scope[mode].push((bullet[1] ?? '').trim())
  }
  return scope.in.length || scope.out.length ? scope : null
}

const parseRisks = (section: MarkdownSection | undefined) => {
  if (!section) return []
  const risks: string[] = []
  for (const line of section.body.split(/\r?\n/)) {
    const trimmed = line.trim()
    const bullet = /^-\s+(.+)$/.exec(trimmed)
    if (bullet) {
      risks.push((bullet[1] ?? '').trim())
      continue
    }
    if (/^\|.+\|$/.test(trimmed) && !/^\|?\s*:?-+/.test(trimmed)) {
      const cells = trimmed
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean)
      const joined = cells.join(' ')
      if (cells.length && !joined.toLowerCase().includes('risk') && !joined.includes('风险')) {
        risks.push(cells.join(' · '))
      }
    }
  }
  return risks
}

export const parsePlanDoc = (content: string): ParsedPlan => {
  const parsed = EMPTY_PLAN(content)
  try {
    const { body, frontmatter } = stripFrontmatter(content)
    parsed.frontmatter = frontmatter
    const sections = splitSections(body, 2)
    parsed.goal = findSection(sections, [/^目标$/, /^goal$/i])?.body.trim() || null
    parsed.milestones = parseMilestones(findSection(sections, [/^里程碑/, /^milestones?$/i]))
    parsed.scope = parseScope(findSection(sections, [/^scope$/i]))
    parsed.risks = parseRisks(findSection(sections, [/^已知\s*risk/i, /^risks?$/i]))
    parsed.currentPhase =
      findSection(sections, [/^当前\s*phase/i, /^current\s*phase$/i])?.body.trim() || null
  } catch (error) {
    parsed.parseError = error instanceof Error ? error.message : String(error)
  }
  return parsed
}
