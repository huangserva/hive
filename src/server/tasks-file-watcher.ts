import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import chokidar, { type FSWatcher } from 'chokidar'

import {
  ensurePmDocs,
  ensureProtocolFile,
  ensureTasksFile,
  getPlanFilePath,
  getTasksFilePath,
  HIVE_DIR_NAME,
} from './tasks-file.js'

const DEBOUNCE_MS = 100

export interface TasksFileWatcher {
  close: () => Promise<void>
  start: (workspaceId: string, workspacePath: string) => Promise<void>
  stop: (workspaceId: string) => Promise<void>
}

export const createTasksFileWatcher = ({
  onCockpitUpdated,
  onPlanUpdated,
  onTasksUpdated,
}: {
  onCockpitUpdated?: (workspaceId: string) => void
  onPlanUpdated?: (workspaceId: string, content: string) => void
  onTasksUpdated: (workspaceId: string, content: string) => void
}): TasksFileWatcher => {
  const watchers = new Map<string, FSWatcher>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  const clearTimer = (workspaceId: string) => {
    for (const kind of ['cockpit', 'plan', 'tasks'] as const) {
      const key = timerKey(workspaceId, kind)
      const timer = timers.get(key)
      if (!timer) continue
      clearTimeout(timer)
      timers.delete(key)
    }
  }

  const timerKey = (workspaceId: string, kind: 'cockpit' | 'plan' | 'tasks') =>
    `${workspaceId}:${kind}`

  const emitCurrentContent = async (workspaceId: string, workspacePath: string) => {
    const tasksPath = getTasksFilePath(workspacePath)
    try {
      const content = existsSync(tasksPath) ? await readFile(tasksPath, 'utf8') : ''
      onTasksUpdated(workspaceId, content)
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error
      onTasksUpdated(workspaceId, '')
    }
  }

  const emitCurrentPlan = async (workspaceId: string, workspacePath: string) => {
    const planPath = getPlanFilePath(workspacePath)
    try {
      const content = existsSync(planPath) ? await readFile(planPath, 'utf8') : ''
      onPlanUpdated?.(workspaceId, content)
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error
      onPlanUpdated?.(workspaceId, '')
    }
  }

  const stop = async (workspaceId: string) => {
    clearTimer(workspaceId)
    const watcher = watchers.get(workspaceId)
    watchers.delete(workspaceId)
    await watcher?.close()
  }

  return {
    close: async () => {
      await Promise.all(Array.from(watchers.keys(), (workspaceId) => stop(workspaceId)))
    },
    start: async (workspaceId, workspacePath) => {
      await stop(workspaceId)
      ensureTasksFile(workspacePath)
      ensurePmDocs(workspacePath)
      ensureProtocolFile(workspacePath)
      const tasksPath = getTasksFilePath(workspacePath)
      const planPath = getPlanFilePath(workspacePath)
      const hiveDir = `${workspacePath}/${HIVE_DIR_NAME}`
      const watcher = chokidar.watch(
        [
          tasksPath,
          planPath,
          `${hiveDir}/open-questions.md`,
          `${hiveDir}/ideas/**`,
          `${hiveDir}/research/**`,
          `${hiveDir}/baseline/**`,
          `${hiveDir}/decisions/**`,
          `${hiveDir}/archive/**`,
        ],
        {
          ignoreInitial: true,
        }
      )
      const scheduleKind = (kind: 'cockpit' | 'plan' | 'tasks') => {
        const key = timerKey(workspaceId, kind)
        const timer = timers.get(key)
        if (timer) clearTimeout(timer)
        timers.set(
          key,
          setTimeout(() => {
            timers.delete(key)
            if (kind === 'plan') {
              void emitCurrentPlan(workspaceId, workspacePath)
            } else if (kind === 'tasks') {
              void emitCurrentContent(workspaceId, workspacePath)
            } else {
              onCockpitUpdated?.(workspaceId)
            }
          }, DEBOUNCE_MS)
        )
      }
      const scheduleEmit = (path: string) => {
        if (path === planPath) scheduleKind('plan')
        else if (path === tasksPath) scheduleKind('tasks')
        scheduleKind('cockpit')
      }
      watcher.on('add', scheduleEmit)
      watcher.on('change', scheduleEmit)
      watcher.on('unlink', scheduleEmit)
      watchers.set(workspaceId, watcher)
      await new Promise<void>((resolve) => watcher.once('ready', () => resolve()))
    },
    stop,
  }
}
