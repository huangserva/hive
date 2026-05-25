import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { BadRequestError, NotFoundError } from './http-errors.js'

export type PMQuestionPriority = 'high' | 'medium' | 'low'

export interface PMQuestion {
  answer?: string
  answered?: boolean
  id: string
  priority: PMQuestionPriority
  raw: string
  text: string
}

export interface ParsedQuestions {
  answered: PMQuestion[]
  high: PMQuestion[]
  low: PMQuestion[]
  medium: PMQuestion[]
  parseError: string | null
  raw: string
}

const emptyQuestions = (content: string): ParsedQuestions => ({
  answered: [],
  high: [],
  low: [],
  medium: [],
  parseError: null,
  raw: content,
})

const ANSWER_SEPARATOR = /\s+→\s+\*\*answered\s+\d{4}-\d{2}-\d{2}\*\*[：:]\s*/
const QUESTION_LINE_RE = /^\s*-\s+\[[ xX]\]\s+\*\*(Q[\w-]+)\*\*\s+(.+?)\s*$/

const parseQuestionLine = (
  line: string,
  priority: PMQuestionPriority,
  answered = false
): PMQuestion | null => {
  const match = QUESTION_LINE_RE.exec(line)
  if (!match) return null
  const rawText = (match[2] ?? '').trim()
  const [questionText, answer] = rawText.split(ANSWER_SEPARATOR)
  return {
    ...(answer ? { answer: answer.trim() } : {}),
    ...(answered ? { answered: true } : {}),
    id: match[1] ?? 'Q?',
    priority,
    raw: line,
    text: (questionText ?? rawText).trim(),
  }
}

export const parseQuestionsDoc = (content: string): ParsedQuestions => {
  const parsed = emptyQuestions(content)
  try {
    let section: PMQuestionPriority | 'answered' | null = null
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim().toLowerCase()
      if (/^###\s+.*\bhigh\b/.test(trimmed)) {
        section = 'high'
        continue
      }
      if (/^###\s+.*\bmedium\b/.test(trimmed)) {
        section = 'medium'
        continue
      }
      if (/^###\s+.*\blow\b/.test(trimmed)) {
        section = 'low'
        continue
      }
      if (/^##\s+已答/.test(line.trim())) {
        section = 'answered'
        continue
      }
      if (!section) continue
      const question = parseQuestionLine(
        line,
        section === 'answered' ? 'low' : section,
        section === 'answered'
      )
      if (!question) continue
      if (section === 'answered') parsed.answered.push(question)
      else parsed[section].push(question)
    }
  } catch (error) {
    parsed.parseError = error instanceof Error ? error.message : String(error)
  }
  return parsed
}

const answeredLine = (questionId: string, questionText: string, answer: string) =>
  `- [x] **${questionId}** ${questionText} → **answered ${new Date().toISOString().slice(0, 10)}**：${answer}`

const questionLine = (questionId: string, questionText: string) =>
  `- [ ] **${questionId}** ${questionText}`

const isHeading = (line: string) => /^##/.test(line.trim())
const isQuestionLine = (line: string) => QUESTION_LINE_RE.test(line)

const findQuestionBlock = (lines: string[], questionId: string) => {
  let inAnswered = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (/^##\s+已答/.test(line.trim())) inAnswered = true
    const question = parseQuestionLine(line, 'low')
    if (!question || question.id !== questionId || inAnswered) continue

    let end = index + 1
    while (end < lines.length) {
      const next = lines[end] ?? ''
      if (isHeading(next) || isQuestionLine(next)) break
      end += 1
    }
    return { end, question, start: index }
  }
  return null
}

const appendAnsweredLine = (lines: string[], line: string) => {
  const answeredIndex = lines.findIndex((current) => /^##\s+已答/.test(current.trim()))
  if (answeredIndex === -1) {
    return [...lines, '', '## 已答（archive 留追溯）', '', line]
  }

  const nextLines = [...lines]
  let insertAt = nextLines.length
  for (let index = answeredIndex + 1; index < nextLines.length; index += 1) {
    if (/^##\s+/.test(nextLines[index]?.trim() ?? '')) {
      insertAt = index
      break
    }
  }

  const placeholderIndex = nextLines.findIndex(
    (current, index) => index > answeredIndex && current.trim() === '（暂无）'
  )
  if (placeholderIndex > answeredIndex && placeholderIndex < insertAt) {
    nextLines.splice(placeholderIndex, 1)
    insertAt -= 1
  }

  nextLines.splice(insertAt, 0, line)
  return nextLines
}

export const answerQuestionInFile = (workspacePath: string, questionId: string, answer: string) => {
  const trimmedAnswer = answer.trim()
  if (!trimmedAnswer) throw new BadRequestError('answer must not be empty')

  const questionsPath = join(workspacePath, '.hive', 'open-questions.md')
  if (!existsSync(questionsPath)) {
    throw new NotFoundError('open-questions.md not found')
  }

  const content = readFileSync(questionsPath, 'utf8')
  const lines = content.split(/\r?\n/)
  const block = findQuestionBlock(lines, questionId)
  if (!block) {
    throw new NotFoundError(`Question not found: ${questionId}`)
  }

  const nextLines = [...lines]
  nextLines.splice(block.start, block.end - block.start)
  const output = appendAnsweredLine(
    nextLines,
    answeredLine(questionId, block.question.text, trimmedAnswer.replace(/\s+/g, ' '))
  ).join('\n')
  writeFileSync(questionsPath, output.endsWith('\n') ? output : `${output}\n`, 'utf8')
}

const nextQuestionId = (lines: string[]) => {
  let max = 0
  for (const line of lines) {
    const match = /\*\*Q(\d+)\*\*/.exec(line)
    if (!match) continue
    max = Math.max(max, Number(match[1]))
  }
  return `Q${max + 1}`
}

const appendOpenQuestionLine = (lines: string[], line: string) => {
  const mediumIndex = lines.findIndex((current) => /^###\s+.*\bmedium\b/i.test(current.trim()))
  const highIndex = lines.findIndex((current) => /^###\s+.*\bhigh\b/i.test(current.trim()))
  const anchorIndex = mediumIndex !== -1 ? mediumIndex : highIndex
  if (anchorIndex === -1) return [...lines, '', '### 🟠 medium — 影响下一步规划', '', line]

  const nextLines = [...lines]
  let insertAt = nextLines.length
  for (let index = anchorIndex + 1; index < nextLines.length; index += 1) {
    if (
      /^###\s+/.test(nextLines[index]?.trim() ?? '') ||
      /^##\s+已答/.test(nextLines[index]?.trim() ?? '')
    ) {
      insertAt = index
      break
    }
  }

  const placeholderIndex = nextLines.findIndex(
    (current, index) => index > anchorIndex && current.trim() === '（暂无）'
  )
  if (placeholderIndex > anchorIndex && placeholderIndex < insertAt) {
    nextLines.splice(placeholderIndex, 1)
    insertAt -= 1
  }

  nextLines.splice(insertAt, 0, line)
  return nextLines
}

export const appendQuestionInFile = (workspacePath: string, questionText: string) => {
  const trimmed = questionText.trim()
  if (!trimmed) throw new BadRequestError('question must not be empty')

  const questionsPath = join(workspacePath, '.hive', 'open-questions.md')
  if (!existsSync(questionsPath)) {
    throw new NotFoundError('open-questions.md not found')
  }

  const content = readFileSync(questionsPath, 'utf8')
  const lines = content.split(/\r?\n/)
  const questionId = nextQuestionId(lines)
  const output = appendOpenQuestionLine(lines, questionLine(questionId, trimmed)).join('\n')
  writeFileSync(questionsPath, output.endsWith('\n') ? output : `${output}\n`, 'utf8')
  return { questionId }
}
