export type PMTasksSectionKey = 'in_progress' | 'open' | 'done' | 'other'

export interface PMTaskItem {
  done: boolean
  raw: string
  text: string
}

export interface PMTaskSubsection {
  doneCount: number
  openCount: number
  title: string
  totalCount: number
  items: PMTaskItem[]
}

export interface PMTaskSection {
  doneCount: number
  key: PMTasksSectionKey
  openCount: number
  subsections: PMTaskSubsection[]
  title: string
  totalCount: number
  items: PMTaskItem[]
}

export interface ParsedTasks {
  parseError: string | null
  raw: string
  sections: PMTaskSection[]
  totalDone: number
  totalOpen: number
}

const sectionKey = (title: string): PMTasksSectionKey => {
  const normalized = title.toLowerCase()
  if (/in progress|进行中/.test(normalized)) return 'in_progress'
  if (/^open|待.*决定|待办/.test(normalized)) return 'open'
  if (/done|完成|已完成/.test(normalized)) return 'done'
  return 'other'
}

const emptySection = (title: string): PMTaskSection => ({
  doneCount: 0,
  items: [],
  key: sectionKey(title),
  openCount: 0,
  subsections: [],
  title,
  totalCount: 0,
})

const emptySubsection = (title: string): PMTaskSubsection => ({
  doneCount: 0,
  items: [],
  openCount: 0,
  title,
  totalCount: 0,
})

const parseTaskLine = (line: string): PMTaskItem | null => {
  const match = /^\s*-\s+\[([ xX])\]\s+(.+?)\s*$/.exec(line)
  if (!match) return null
  return {
    done: match[1]?.toLowerCase() === 'x',
    raw: line,
    text: (match[2] ?? '').trim(),
  }
}

const addTask = (section: PMTaskSection, subsection: PMTaskSubsection | null, task: PMTaskItem) => {
  const target = subsection ?? section
  target.items.push(task)
  target.totalCount += 1
  if (task.done) target.doneCount += 1
  else target.openCount += 1

  if (subsection) {
    section.totalCount += 1
    if (task.done) section.doneCount += 1
    else section.openCount += 1
  }
}

export const parseTasksDoc = (content: string): ParsedTasks => {
  const parsed: ParsedTasks = {
    parseError: null,
    raw: content,
    sections: [],
    totalDone: 0,
    totalOpen: 0,
  }
  try {
    let currentSection: PMTaskSection | null = null
    let currentSubsection: PMTaskSubsection | null = null
    for (const line of content.split(/\r?\n/)) {
      const section = /^##\s+(.+?)\s*$/.exec(line)
      if (section) {
        currentSection = emptySection((section[1] ?? '').trim())
        parsed.sections.push(currentSection)
        currentSubsection = null
        continue
      }

      const subsection = /^###\s+(.+?)\s*$/.exec(line)
      if (subsection && currentSection) {
        currentSubsection = emptySubsection((subsection[1] ?? '').trim())
        currentSection.subsections.push(currentSubsection)
        continue
      }

      const task = parseTaskLine(line)
      if (!task) continue
      if (!currentSection) {
        currentSection = emptySection('Tasks')
        parsed.sections.push(currentSection)
      }
      addTask(currentSection, currentSubsection, task)
      if (task.done) parsed.totalDone += 1
      else parsed.totalOpen += 1
    }
  } catch (error) {
    parsed.parseError = error instanceof Error ? error.message : String(error)
  }
  return parsed
}
