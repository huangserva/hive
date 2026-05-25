import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { buildProtocolDoc } from './hive-team-guidance.js'
import type { HiveLogger } from './logger.js'
import {
  ADR_TEMPLATE,
  BASELINE_INDEX_TEMPLATE,
  BASELINE_MODULE_MAP_TEMPLATE,
  BASELINE_PLACEHOLDER_TEMPLATE,
  BASELINE_RUNTIME_FLOWS_TEMPLATE,
  HANDOFF_TEMPLATE,
  IDEAS_INBOX_TEMPLATE,
  MILESTONE_REVIEW_TEMPLATE,
  OPEN_QUESTIONS_TEMPLATE,
  PLAN_TEMPLATE,
  PLAYBOOK_HANDOFF_TEMPLATE,
  RESEARCH_TEMPLATE,
} from './pm-templates.js'

interface TasksFileService {
  /** cancel 时调用：标 cancelled */
  recordDispatchCancelled: (
    workspacePath: string,
    input: {
      dispatchId: string
      reason: string
    }
  ) => void
  /** report 时调用：找到对应 dispatch_id 的行，把 [ ] 改 [x] */
  recordDispatchDone: (
    workspacePath: string,
    input: {
      dispatchId: string
    }
  ) => void
  /** 派单时调用：在 ## In progress 段追加一行 */
  recordDispatchSent: (
    workspacePath: string,
    input: {
      dispatchId: string
      taskFirstLine: string
      workerName: string
    }
  ) => void
  readPlan: (workspacePath: string) => string
  readTasks: (workspacePath: string) => string
  writeTasks: (workspacePath: string, content: string) => void
}

interface CreateTasksFileServiceOptions {
  logger?: Pick<HiveLogger, 'warn'>
}

export const HIVE_DIR_NAME = '.hive'
export const TASKS_FILE_NAME = 'tasks.md'
export const TASKS_RELATIVE_PATH = `${HIVE_DIR_NAME}/${TASKS_FILE_NAME}`
export const PROTOCOL_FILE_NAME = 'PROTOCOL.md'
export const PROTOCOL_RELATIVE_PATH = `${HIVE_DIR_NAME}/${PROTOCOL_FILE_NAME}`
export const PLAN_FILE_NAME = 'plan.md'
export const TEMPLATES_DIR_NAME = 'templates'

export const getTasksFilePath = (workspacePath: string) =>
  join(workspacePath, HIVE_DIR_NAME, TASKS_FILE_NAME)

export const getProtocolFilePath = (workspacePath: string) =>
  join(workspacePath, HIVE_DIR_NAME, PROTOCOL_FILE_NAME)

export const getPlanFilePath = (workspacePath: string) =>
  join(workspacePath, HIVE_DIR_NAME, PLAN_FILE_NAME)

const getLegacyTasksFilePath = (workspacePath: string) => join(workspacePath, TASKS_FILE_NAME)

const ensureTasksDir = (workspacePath: string) => {
  mkdirSync(dirname(getTasksFilePath(workspacePath)), { recursive: true })
}

const renderInitialPlan = (workspacePath: string) => {
  const today = new Date().toISOString().slice(0, 10)
  const projectName = basename(workspacePath) || 'Workspace'
  return PLAN_TEMPLATE.replaceAll('{{PROJECT_NAME}}', projectName).replaceAll(
    '{{YYYY-MM-DD}}',
    today
  )
}

const renderProjectTemplate = (template: string, workspacePath: string) =>
  template.replaceAll('{{PROJECT_NAME}}', basename(workspacePath) || 'Workspace')

const renderBaselinePlaceholder = (title: string) =>
  BASELINE_PLACEHOLDER_TEMPLATE.replaceAll('{{TITLE}}', title)

const ensureFileIfMissing = (filePath: string, content: string) => {
  mkdirSync(dirname(filePath), { recursive: true })
  if (!existsSync(filePath)) {
    writeFileSync(filePath, content, 'utf8')
  }
}

const DISPATCH_LINE_PATTERN =
  /^- \[[ x~]\] \*\*(.+?)\*\* dispatch `([0-9a-fA-F-]{8})` \u2014 (.*)$/u

const truncateText = (value: string, maxLength: number) => {
  const normalized = value.split(/\r?\n/, 1)[0]?.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
}

const getDispatchShortId = (dispatchId: string) => dispatchId.slice(0, 8)

const findInProgressSection = (lines: string[]) => {
  const start = lines.findIndex((line) => /^##\s+In progress\s*$/i.test(line.trim()))
  if (start === -1) return null
  const nextSection = lines.findIndex((line, index) => index > start && /^##\s+/.test(line))
  return {
    end: nextSection === -1 ? lines.length : nextSection,
    start,
  }
}

const findDispatchLine = (lines: string[], dispatchShortId: string) =>
  lines.findIndex((line) => {
    const match = DISPATCH_LINE_PATTERN.exec(line)
    return match?.[2] === dispatchShortId
  })

const safeReadTasksFile = (
  workspacePath: string,
  logger: Pick<HiveLogger, 'warn'> | undefined,
  operation: string
) => {
  const tasksFilePath = getTasksFilePath(workspacePath)
  if (!existsSync(tasksFilePath)) {
    logger?.warn(`tasks lifecycle ${operation} skipped: missing tasks.md path=${tasksFilePath}`)
    return null
  }
  try {
    return readFileSync(tasksFilePath, 'utf8')
  } catch (error) {
    logger?.warn(`tasks lifecycle ${operation} skipped: failed to read tasks.md`, error)
    return null
  }
}

const safeWriteTasksFile = (
  workspacePath: string,
  content: string,
  logger: Pick<HiveLogger, 'warn'> | undefined,
  operation: string
) => {
  try {
    writeFileSync(getTasksFilePath(workspacePath), content, 'utf8')
  } catch (error) {
    logger?.warn(`tasks lifecycle ${operation} skipped: failed to write tasks.md`, error)
  }
}

const updateTasksContent = (
  workspacePath: string,
  logger: Pick<HiveLogger, 'warn'> | undefined,
  operation: string,
  update: (lines: string[]) => string[] | null
) => {
  const content = safeReadTasksFile(workspacePath, logger, operation)
  if (content === null) return
  const lines = content.split(/\r?\n/)
  const nextLines = update(lines)
  if (!nextLines) return
  safeWriteTasksFile(workspacePath, nextLines.join('\n'), logger, operation)
}

export const ensureTasksFile = (workspacePath: string) => {
  ensureTasksDir(workspacePath)
  const tasksFilePath = getTasksFilePath(workspacePath)
  if (existsSync(tasksFilePath)) {
    return readFileSync(tasksFilePath, 'utf8')
  }

  const legacyTasksFilePath = getLegacyTasksFilePath(workspacePath)
  const content = existsSync(legacyTasksFilePath) ? readFileSync(legacyTasksFilePath, 'utf8') : ''
  writeFileSync(tasksFilePath, content, 'utf8')
  return content
}

/**
 * Always overwrites `.hive/PROTOCOL.md` with the freshly-built protocol doc.
 * The doc is marked auto-generated so user edits are not expected; rewriting
 * on every workspace open means a Hive version bump that changes the rules
 * propagates without manual intervention.
 */
export const ensureProtocolFile = (workspacePath: string) => {
  ensureTasksDir(workspacePath)
  const protocolFilePath = getProtocolFilePath(workspacePath)
  const desired = buildProtocolDoc()
  const current = existsSync(protocolFilePath) ? readFileSync(protocolFilePath, 'utf8') : null
  if (current === desired) return desired
  writeFileSync(protocolFilePath, desired, 'utf8')
  return desired
}

export const ensurePmDocs = (workspacePath: string) => {
  ensureTasksDir(workspacePath)
  const planFilePath = getPlanFilePath(workspacePath)
  if (!existsSync(planFilePath)) {
    writeFileSync(planFilePath, renderInitialPlan(workspacePath), 'utf8')
  }

  const hiveDir = join(workspacePath, HIVE_DIR_NAME)
  const baselineDir = join(hiveDir, 'baseline')
  ensureFileIfMissing(join(hiveDir, 'open-questions.md'), OPEN_QUESTIONS_TEMPLATE)
  ensureFileIfMissing(join(hiveDir, 'ideas', 'inbox.md'), IDEAS_INBOX_TEMPLATE)
  ensureFileIfMissing(
    join(baselineDir, 'README.md'),
    renderProjectTemplate(BASELINE_INDEX_TEMPLATE, workspacePath)
  )
  ensureFileIfMissing(join(baselineDir, 'module-map.md'), BASELINE_MODULE_MAP_TEMPLATE)
  ensureFileIfMissing(join(baselineDir, 'runtime-flows.md'), BASELINE_RUNTIME_FLOWS_TEMPLATE)
  ensureFileIfMissing(
    join(baselineDir, 'state-storage.md'),
    renderBaselinePlaceholder('State Storage')
  )
  ensureFileIfMissing(join(baselineDir, 'test-gates.md'), renderBaselinePlaceholder('Test Gates'))
  ensureFileIfMissing(
    join(baselineDir, 'risk-hotspots.md'),
    renderBaselinePlaceholder('Risk Hotspots')
  )
  ensureFileIfMissing(join(hiveDir, 'decisions', '.gitkeep'), '')
  ensureFileIfMissing(join(hiveDir, 'research', '.gitkeep'), '')
  ensureFileIfMissing(join(hiveDir, 'archive', '.gitkeep'), '')

  const templatesDir = join(workspacePath, HIVE_DIR_NAME, TEMPLATES_DIR_NAME)
  mkdirSync(templatesDir, { recursive: true })
  const templates = [
    ['plan.template.md', PLAN_TEMPLATE],
    ['adr.template.md', ADR_TEMPLATE],
    ['handoff.template.html', HANDOFF_TEMPLATE],
    ['research.template.md', RESEARCH_TEMPLATE],
    ['milestone-review.template.md', MILESTONE_REVIEW_TEMPLATE],
    ['playbook-handoff.template.md', PLAYBOOK_HANDOFF_TEMPLATE],
    ['open-questions.template.md', OPEN_QUESTIONS_TEMPLATE],
    ['ideas-inbox.template.md', IDEAS_INBOX_TEMPLATE],
    ['baseline.template.md', BASELINE_PLACEHOLDER_TEMPLATE],
  ] as const
  for (const [fileName, content] of templates) {
    ensureFileIfMissing(join(templatesDir, fileName), content)
  }
}

export const createTasksFileService = (
  options: CreateTasksFileServiceOptions = {}
): TasksFileService => {
  const { logger } = options
  return {
    recordDispatchCancelled(workspacePath, input) {
      const dispatchShortId = getDispatchShortId(input.dispatchId)
      const reason = truncateText(input.reason, 80)
      updateTasksContent(workspacePath, logger, 'cancel', (lines) => {
        const lineIndex = findDispatchLine(lines, dispatchShortId)
        if (lineIndex === -1) {
          logger?.warn(`tasks lifecycle cancel skipped: dispatch not found id=${dispatchShortId}`)
          return null
        }
        const currentLine = lines[lineIndex]
        if (!currentLine) return null
        const match = DISPATCH_LINE_PATTERN.exec(currentLine)
        const workerName = match?.[1]
        const shortId = match?.[2]
        const body = match?.[3]
        if (!workerName || !shortId || !body) return null
        lines[lineIndex] = `- [~] **${workerName}** dispatch \`${shortId}\` — ${body} ⊘ ${reason}`
        return lines
      })
    },

    recordDispatchDone(workspacePath, input) {
      const dispatchShortId = getDispatchShortId(input.dispatchId)
      updateTasksContent(workspacePath, logger, 'done', (lines) => {
        const lineIndex = findDispatchLine(lines, dispatchShortId)
        if (lineIndex === -1) {
          logger?.warn(`tasks lifecycle done skipped: dispatch not found id=${dispatchShortId}`)
          return null
        }
        const currentLine = lines[lineIndex]
        if (!currentLine) return null
        lines[lineIndex] = currentLine.replace(/^- \[[ x~]\]/, '- [x]')
        return lines
      })
    },

    recordDispatchSent(workspacePath, input) {
      const dispatchShortId = getDispatchShortId(input.dispatchId)
      const taskFirstLine = truncateText(input.taskFirstLine, 120)
      updateTasksContent(workspacePath, logger, 'send', (lines) => {
        const section = findInProgressSection(lines)
        if (!section) {
          logger?.warn('tasks lifecycle send skipped: missing ## In progress section')
          return null
        }
        if (findDispatchLine(lines, dispatchShortId) !== -1) return null
        const line = `- [ ] **${input.workerName}** dispatch \`${dispatchShortId}\` — ${taskFirstLine}`
        lines.splice(section.end, 0, line)
        return lines
      })
    },

    readPlan(workspacePath) {
      ensurePmDocs(workspacePath)
      const planPath = getPlanFilePath(workspacePath)
      return existsSync(planPath) ? readFileSync(planPath, 'utf8') : ''
    },

    readTasks(workspacePath) {
      return ensureTasksFile(workspacePath)
    },

    writeTasks(workspacePath, content) {
      ensureTasksDir(workspacePath)
      writeFileSync(getTasksFilePath(workspacePath), content, 'utf8')
    },
  }
}

export type { TasksFileService }
