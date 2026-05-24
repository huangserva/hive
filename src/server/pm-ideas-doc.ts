export interface PMIdea {
  addedAt: string | null
  id: string
  promoted: boolean
  raw: string
  text: string
}

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
      const bullet = /^\s*-\s+(.+?)\s*$/.exec(line)
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
