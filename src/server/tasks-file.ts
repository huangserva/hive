import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { buildProtocolDoc } from './hive-team-guidance.js'
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
  RESEARCH_TEMPLATE,
} from './pm-templates.js'

interface TasksFileService {
  readPlan: (workspacePath: string) => string
  readTasks: (workspacePath: string) => string
  writeTasks: (workspacePath: string, content: string) => void
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
    ['open-questions.template.md', OPEN_QUESTIONS_TEMPLATE],
    ['ideas-inbox.template.md', IDEAS_INBOX_TEMPLATE],
    ['baseline.template.md', BASELINE_PLACEHOLDER_TEMPLATE],
  ] as const
  for (const [fileName, content] of templates) {
    ensureFileIfMissing(join(templatesDir, fileName), content)
  }
}

export const createTasksFileService = (): TasksFileService => {
  return {
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
