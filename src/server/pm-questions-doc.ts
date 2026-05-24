export type PMQuestionPriority = 'high' | 'medium' | 'low'

export interface PMQuestion {
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

const parseQuestionLine = (line: string, priority: PMQuestionPriority): PMQuestion | null => {
  const match = /^\s*-\s+\[[ xX]\]\s+\*\*(Q\d+)\*\*\s*(.+?)\s*$/.exec(line)
  if (!match) return null
  return {
    id: match[1] ?? 'Q?',
    priority,
    raw: line,
    text: (match[2] ?? '').trim(),
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
      const question = parseQuestionLine(line, section === 'answered' ? 'low' : section)
      if (!question) continue
      if (section === 'answered') parsed.answered.push(question)
      else parsed[section].push(question)
    }
  } catch (error) {
    parsed.parseError = error instanceof Error ? error.message : String(error)
  }
  return parsed
}
