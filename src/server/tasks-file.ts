import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { buildProtocolDoc } from './hive-team-guidance.js'
import {
  ADR_TEMPLATE,
  HANDOFF_TEMPLATE,
  MILESTONE_REVIEW_TEMPLATE,
  PLAN_TEMPLATE,
  RESEARCH_TEMPLATE,
} from './pm-templates.js'

interface TasksFileService {
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

  const templatesDir = join(workspacePath, HIVE_DIR_NAME, TEMPLATES_DIR_NAME)
  mkdirSync(templatesDir, { recursive: true })
  const templates = [
    ['plan.template.md', PLAN_TEMPLATE],
    ['adr.template.md', ADR_TEMPLATE],
    ['handoff.template.html', HANDOFF_TEMPLATE],
    ['research.template.md', RESEARCH_TEMPLATE],
    ['milestone-review.template.md', MILESTONE_REVIEW_TEMPLATE],
  ] as const
  for (const [fileName, content] of templates) {
    const filePath = join(templatesDir, fileName)
    if (!existsSync(filePath)) {
      writeFileSync(filePath, content, 'utf8')
    }
  }
}

export const createTasksFileService = (): TasksFileService => {
  return {
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
