import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { BadRequestError, NotFoundError } from './http-errors.js'
import { appendQuestionInFile } from './pm-questions-doc.js'

export interface PMIdea {
  addedAt: string | null
  id: string
  promoted: boolean
  raw: string
  text: string
}

export type IdeaPromoteTarget = 'adr' | 'plan' | 'question'

export interface ParsedIdeas {
  inbox: PMIdea[]
  parseError: string | null
  promoted: PMIdea[]
  raw: string
}

const emptyIdeas = (content: string): ParsedIdeas => ({
  inbox: [],
  parseError: null,
  promoted: [],
  raw: content,
})

const stripIdeaMarker = (text: string) =>
  text
    .replace(/^🤔\s*idea:\s*/i, '')
    .replace(/^idea:\s*/i, '')
    .replace(/^~~|~~$/g, '')
    .trim()

const today = () => new Date().toISOString().slice(0, 10)

const topLevelBullet = (line: string) => /^-\s+(.+?)\s*$/.exec(line)

const findIdeaBlock = (lines: string[], ideaId: string) => {
  let section: 'inbox' | 'promoted' | null = null
  let counter = 0
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]?.trim() ?? ''
    if (/^##\s+inbox/i.test(trimmed)) {
      section = 'inbox'
      continue
    }
    if (/^##\s+promoted/i.test(trimmed)) {
      section = 'promoted'
      continue
    }
    if (section !== 'inbox') continue
    const bullet = topLevelBullet(lines[index] ?? '')
    if (!bullet) continue
    counter += 1
    if (`I${counter}` !== ideaId) continue

    let end = index + 1
    while (end < lines.length) {
      const next = lines[end] ?? ''
      if (/^##\s+/.test(next.trim()) || /^###\s+/.test(next.trim()) || topLevelBullet(next)) break
      end += 1
    }
    const rawText = (bullet[1] ?? '').trim()
    return {
      end,
      start: index,
      text: stripIdeaMarker(rawText),
    }
  }
  return null
}

const appendPromotedIdea = (lines: string[], text: string, target: IdeaPromoteTarget) => {
  const promotedIndex = lines.findIndex((line) => /^##\s+promoted/i.test(line.trim()))
  const nextLines = promotedIndex === -1 ? [...lines, '', '## promoted', ''] : [...lines]
  const anchorIndex =
    promotedIndex === -1
      ? nextLines.findIndex((line) => /^##\s+promoted/i.test(line.trim()))
      : promotedIndex

  let insertAt = nextLines.length
  for (let index = anchorIndex + 1; index < nextLines.length; index += 1) {
    if (/^##\s+/.test(nextLines[index]?.trim() ?? '')) {
      insertAt = index
      break
    }
  }

  const placeholderIndex = nextLines.findIndex(
    (line, index) => index > anchorIndex && line.trim() === '（暂无）'
  )
  if (placeholderIndex > anchorIndex && placeholderIndex < insertAt) {
    nextLines.splice(placeholderIndex, 1)
    insertAt -= 1
  }

  nextLines.splice(insertAt, 0, `- ~~${text}~~ → promoted to ${target}`)
  return nextLines
}

const slugFromText = (text: string) => {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'promoted-idea'
}

const appendPlanMilestone = (workspacePath: string, text: string) => {
  const planPath = join(workspacePath, '.hive', 'plan.md')
  if (!existsSync(planPath)) throw new NotFoundError('plan.md not found')
  const content = readFileSync(planPath, 'utf8')
  const maxMilestone = Array.from(content.matchAll(/^###\s+M(\d+)\b/gm)).reduce(
    (max, match) => Math.max(max, Number(match[1])),
    0
  )
  const milestone = `### M${maxMilestone + 1} · ${text} · proposed\n- [ ] 从 ideas/inbox promote，待拆 scope / owner / 验证方式\n\n`
  const scopeIndex = content.search(/^##\s+Scope\b/m)
  const nextContent =
    scopeIndex === -1
      ? `${content.trimEnd()}\n\n${milestone}`
      : `${content.slice(0, scopeIndex).trimEnd()}\n\n${milestone}${content.slice(scopeIndex)}`
  writeFileSync(planPath, nextContent.endsWith('\n') ? nextContent : `${nextContent}\n`, 'utf8')
}

const createAdrDraft = (workspacePath: string, text: string) => {
  const decisionsDir = join(workspacePath, '.hive', 'decisions')
  mkdirSync(decisionsDir, { recursive: true })
  const filename = `draft-${today()}-${slugFromText(text)}.md`
  const filePath = join(decisionsDir, filename)
  if (existsSync(filePath)) throw new BadRequestError(`decision already exists: ${filename}`)
  writeFileSync(
    filePath,
    `# 决策：${text}

**日期**: ${today()}
**状态**: 提案中
**关联**: plan.md → ideas/inbox

## 背景
（从 idea promote：${text}）

## 决策
（待补）

## 理由
1. ...

## 已知代价
- ...

## 结果（后写）
（实施后回填实际效果）
`,
    'utf8'
  )
}

export const parseIdeasDoc = (content: string): ParsedIdeas => {
  const parsed = emptyIdeas(content)
  try {
    let section: 'inbox' | 'promoted' | null = null
    let currentDate: string | null = null
    let counter = 0
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (/^##\s+inbox/i.test(trimmed)) {
        section = 'inbox'
        currentDate = null
        continue
      }
      if (/^##\s+promoted/i.test(trimmed)) {
        section = 'promoted'
        currentDate = null
        continue
      }
      const dateHeading = /^###\s+(\d{4}-\d{2}-\d{2})\b/.exec(trimmed)
      if (dateHeading) {
        currentDate = dateHeading[1] ?? null
        continue
      }
      if (!section) continue
      const bullet = topLevelBullet(line)
      if (!bullet) continue
      counter += 1
      const rawText = (bullet[1] ?? '').trim()
      const promoted = section === 'promoted' || /~~.+~~/.test(rawText)
      const date = /^\d{4}-\d{2}-\d{2}\b/.exec(rawText)?.[0] ?? currentDate
      const idea: PMIdea = {
        addedAt: date,
        id: `I${counter}`,
        promoted,
        raw: line,
        text: stripIdeaMarker(rawText),
      }
      if (section === 'promoted') parsed.promoted.push(idea)
      else parsed.inbox.push(idea)
    }
  } catch (error) {
    parsed.parseError = error instanceof Error ? error.message : String(error)
  }
  return parsed
}

export const promoteIdeaInFile = (
  workspacePath: string,
  ideaId: string,
  target: IdeaPromoteTarget
) => {
  if (!['adr', 'plan', 'question'].includes(target)) {
    throw new BadRequestError('target must be plan, adr, or question')
  }

  const ideasPath = join(workspacePath, '.hive', 'ideas', 'inbox.md')
  if (!existsSync(ideasPath)) throw new NotFoundError('ideas/inbox.md not found')

  const content = readFileSync(ideasPath, 'utf8')
  const lines = content.split(/\r?\n/)
  const block = findIdeaBlock(lines, ideaId)
  if (!block) throw new NotFoundError(`Idea not found: ${ideaId}`)

  const nextLines = [...lines]
  nextLines.splice(block.start, block.end - block.start)
  const promotedLines = appendPromotedIdea(nextLines, block.text, target)
  writeFileSync(
    ideasPath,
    promotedLines.join('\n').endsWith('\n')
      ? promotedLines.join('\n')
      : `${promotedLines.join('\n')}\n`,
    'utf8'
  )

  if (target === 'question') {
    appendQuestionInFile(workspacePath, `是否将 idea 提升为 question：${block.text}`)
  } else if (target === 'plan') {
    appendPlanMilestone(workspacePath, block.text)
  } else {
    createAdrDraft(workspacePath, block.text)
  }
}
