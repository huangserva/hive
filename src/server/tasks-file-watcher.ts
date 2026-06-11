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

/**
 * 监听路径白名单 —— 只 watch 文本文档（.md/.html），绝不递归 watch 二进制资产。
 *
 * 历史事故（2026-06）：`reports/**` 递归 glob 把视频逐帧 jpg 海一起 watch 进去 →
 * 文件描述符耗尽 ENFILE → 随后 node-pty 启 CLI worker 分不到正常 TTY → worker
 * 启动 ~2s exit 1。任何 `assets/` 等二进制目录必须排除在 watch 之外，只认 .md/.html。
 * 改动这里务必保持"只文本文档"不变量，并跑 tasks-file-watcher.test.ts。
 */
export const buildWatchedPaths = (
  tasksPath: string,
  planPath: string,
  hiveDir: string
): string[] => [
  tasksPath,
  planPath,
  `${hiveDir}/open-questions.md`,
  `${hiveDir}/ideas/**/*.md`,
  `${hiveDir}/research/**/*.md`,
  `${hiveDir}/reports/*.html`,
  `${hiveDir}/reports/*.md`,
  `${hiveDir}/baseline/**/*.md`,
  `${hiveDir}/decisions/**/*.md`,
  `${hiveDir}/archive/**/*.md`,
]

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
      const watcher = chokidar.watch(buildWatchedPaths(tasksPath, planPath, hiveDir), {
        ignoreInitial: true,
      })
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
