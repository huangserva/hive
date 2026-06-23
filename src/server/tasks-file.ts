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
  PLAYBOOK_ADVISOR_TEMPLATE,
  PLAYBOOK_COMMITTEE_TEMPLATE,
  PLAYBOOK_EPIC_TEMPLATE,
  PLAYBOOK_HANDOFF_TEMPLATE,
  PLAYBOOK_LOOP_TEMPLATE,
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
  /**
   * report 时调用：找到对应 dispatch_id 的行，决定打 `[x]` 还是 `[~]`。
   *
   * M43 accept-gate（方案 B）：
   * - `reviewStatus` 未传 / 为 null → [x]（旧行为，向后兼容）
   * - `reviewStatus = 'accepted' | 'waived'` → [x]（系统承认完成）
   * - `reviewStatus = 'pending' | 'rejected'` → [~]（reviewable 中间态，正则已支持）
   */
  recordDispatchDone: (
    workspacePath: string,
    input: {
      dispatchId: string
      evidence?: string[]
      reviewStatus?: 'pending' | 'accepted' | 'rejected' | 'waived' | null
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
  /** dispatch 创建后发生后续失败时调用：删除刚追加的 sent 行 */
  recordDispatchRolledBack: (
    workspacePath: string,
    input: {
      dispatchId: string
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
  operation: string,
  input: { throwOnFailure?: boolean } = {}
) => {
  try {
    writeFileSync(getTasksFilePath(workspacePath), content, 'utf8')
  } catch (error) {
    logger?.warn(`tasks lifecycle ${operation} skipped: failed to write tasks.md`, error)
    if (input.throwOnFailure) {
      throw error
    }
  }
}

const updateTasksContent = (
  workspacePath: string,
  logger: Pick<HiveLogger, 'warn'> | undefined,
  operation: string,
  update: (lines: string[]) => string[] | null,
  input: { throwOnWriteFailure?: boolean } = {}
) => {
  const content = safeReadTasksFile(workspacePath, logger, operation)
  if (content === null) return
  const lines = content.split(/\r?\n/)
  const nextLines = update(lines)
  if (!nextLines) return
  safeWriteTasksFile(workspacePath, nextLines.join('\n'), logger, operation, {
    throwOnFailure: input.throwOnWriteFailure === true,
  })
}

const TASKS_SEED_TEMPLATE = `# Tasks

## In progress

## Done
`

const hasInProgressSection = (content: string) => /^##\s+In progress\s*$/im.test(content)

export const ensureTasksFile = (workspacePath: string) => {
  ensureTasksDir(workspacePath)
  const tasksFilePath = getTasksFilePath(workspacePath)
  if (existsSync(tasksFilePath)) {
    return readFileSync(tasksFilePath, 'utf8')
  }

  const legacyTasksFilePath = getLegacyTasksFilePath(workspacePath)
  const legacy = existsSync(legacyTasksFilePath) ? readFileSync(legacyTasksFilePath, 'utf8') : ''
  const content = legacy && hasInProgressSection(legacy) ? legacy : TASKS_SEED_TEMPLATE
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
    ['playbook-loop.template.md', PLAYBOOK_LOOP_TEMPLATE],
    ['playbook-advisor.template.md', PLAYBOOK_ADVISOR_TEMPLATE],
    ['playbook-committee.template.md', PLAYBOOK_COMMITTEE_TEMPLATE],
    ['playbook-epic.template.md', PLAYBOOK_EPIC_TEMPLATE],
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
      // M43: 无 reviewStatus 字段 / null = 旧路径打 [x]；accepted/waived 也 [x]；pending/rejected 进 [~] 中间态。
      const targetMark =
        input.reviewStatus === 'pending' || input.reviewStatus === 'rejected' ? '[~]' : '[x]'
      updateTasksContent(workspacePath, logger, 'done', (lines) => {
        const lineIndex = findDispatchLine(lines, dispatchShortId)
        if (lineIndex === -1) {
          logger?.warn(`tasks lifecycle done skipped: dispatch not found id=${dispatchShortId}`)
          return null
        }
        const currentLine = lines[lineIndex]
        if (!currentLine) return null
        const evidence = input.evidence?.filter((item) => item.trim()).slice(0, 3) ?? []
        const evidenceSuffix =
          evidence.length > 0 ? ` · evidence: ${truncateText(evidence.join(' | '), 180)}` : ''
        const baseLine = currentLine
          .replace(/ · evidence: .+$/u, '')
          .replace(/^- \[[ x~]\]/, `- ${targetMark}`)
        lines[lineIndex] = `${baseLine}${evidenceSuffix}`
        return lines
      })
    },

    recordDispatchSent(workspacePath, input) {
      const dispatchShortId = getDispatchShortId(input.dispatchId)
      const taskFirstLine = truncateText(input.taskFirstLine, 120)
      updateTasksContent(
        workspacePath,
        logger,
        'send',
        (lines) => {
          const section = findInProgressSection(lines)
          if (!section) {
            logger?.warn('tasks lifecycle send skipped: missing ## In progress section')
            return null
          }
          if (findDispatchLine(lines, dispatchShortId) !== -1) return null
          const line = `- [ ] **${input.workerName}** dispatch \`${dispatchShortId}\` — ${taskFirstLine}`
          lines.splice(section.end, 0, line)
          return lines
        },
        {
          throwOnWriteFailure: true,
        }
      )
    },

    recordDispatchRolledBack(workspacePath, input) {
      const dispatchShortId = getDispatchShortId(input.dispatchId)
      updateTasksContent(workspacePath, logger, 'rollback', (lines) => {
        const lineIndex = findDispatchLine(lines, dispatchShortId)
        if (lineIndex === -1) {
          logger?.warn(`tasks lifecycle rollback skipped: dispatch not found id=${dispatchShortId}`)
          return null
        }
        lines.splice(lineIndex, 1)
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
