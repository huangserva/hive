import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface TasksNarrativeNudgeResult {
  shouldNudge: boolean
  reason: string | null
  rule: number | null
}

const MILESTONE_DISPATCH_RE = /\b(M\d+(?:\.\d+)?[a-z]?)[-:：]/iu
const MILESTONE_ID_RE = /\bM\d+(?:\.\d+)?[a-z]?\b/giu
const STALE_TASKS_MTIME_MS = 30 * 60 * 1000
const DISPATCH_BACKLOG_THRESHOLD = 3

const noNudge = (): TasksNarrativeNudgeResult => ({
  reason: null,
  rule: null,
  shouldNudge: false,
})

const normalizeMilestone = (value: string) => {
  const match = value.match(/^M(\d+(?:\.\d+)?)([a-z]?)$/iu)
  if (!match) return value
  return `M${match[1]}${match[2]?.toLowerCase() ?? ''}`
}

const readWorkspaceFile = (workspacePath: string, relativePath: string) => {
  const filePath = join(workspacePath, relativePath)
  if (!existsSync(filePath)) return null
  return readFileSync(filePath, 'utf8')
}

const extractSectionLines = (content: string, headingPattern: RegExp) => {
  const lines = content.split(/\r?\n/)
  const startIndex = lines.findIndex((line) => headingPattern.test(line.trim()))
  if (startIndex === -1) return []
  const sectionLines: string[] = []
  for (const line of lines.slice(startIndex + 1)) {
    if (/^##\s+/.test(line.trim())) break
    sectionLines.push(line)
  }
  return sectionLines
}

const extractInProgressNarrative = (tasksContent: string) =>
  extractSectionLines(tasksContent, /^##\s+In progress\b/i)
    .filter((line) => line.trimStart().startsWith('>'))
    .join('\n')

const extractMilestones = (text: string) =>
  new Set([...text.matchAll(MILESTONE_ID_RE)].map((match) => normalizeMilestone(match[0])))

const parseShippedMilestones = (planContent: string) => {
  const shipped = new Set<string>()
  for (const line of planContent.split(/\r?\n/)) {
    if (!/\b(shipped|已\s*ship|已完成|完成)\b/iu.test(line)) continue
    for (const milestone of extractMilestones(line)) shipped.add(milestone)
  }
  return shipped
}

export function checkTasksNarrativeNudge(
  taskText: string,
  workspacePath: string,
  recentDispatchCount: number,
  tasksFileMtime: number | null
): TasksNarrativeNudgeResult {
  const tasksContent = readWorkspaceFile(workspacePath, '.hive/tasks.md')
  if (tasksContent === null) return noNudge()

  const narrative = extractInProgressNarrative(tasksContent)
  const narrativeMilestones = extractMilestones(narrative)
  const taskMilestoneMatch = taskText.match(MILESTONE_DISPATCH_RE)
  if (taskMilestoneMatch) {
    const milestone = normalizeMilestone(taskMilestoneMatch[1] ?? '')
    if (!narrativeMilestones.has(milestone)) {
      return {
        reason: `[Hive 系统消息：tasks.md 维护提醒] 触发条件：${milestone} 首次 dispatch，tasks.md 缺 sprint narrative 段。建议：更新 In Progress 段，加入该 milestone 的 sprint 结构。`,
        rule: 1,
        shouldNudge: true,
      }
    }
  }

  if (
    tasksFileMtime !== null &&
    Date.now() - tasksFileMtime > STALE_TASKS_MTIME_MS &&
    recentDispatchCount >= DISPATCH_BACKLOG_THRESHOLD
  ) {
    return {
      reason: `[Hive 系统消息：tasks.md 维护提醒] 触发条件：${recentDispatchCount} 条 dispatch 已累积未组织。建议：整理 In Progress 段的 sprint narrative 结构。`,
      rule: 2,
      shouldNudge: true,
    }
  }

  const planContent = readWorkspaceFile(workspacePath, '.hive/plan.md')
  if (planContent !== null) {
    const shippedMilestones = parseShippedMilestones(planContent)
    for (const milestone of narrativeMilestones) {
      if (shippedMilestones.has(milestone)) {
        return {
          reason: `[Hive 系统消息：tasks.md 维护提醒] 触发条件：narrative 引用 ${milestone} 已 shipped。建议：归档到 Done 段，更新 narrative 为当前工作。`,
          rule: 3,
          shouldNudge: true,
        }
      }
    }
  }

  return noNudge()
}
