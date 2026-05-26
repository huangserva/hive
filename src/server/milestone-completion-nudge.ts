import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { MilestoneShippedEvent } from './milestone-completion-trigger.js'
import { parseBaselineDoc } from './pm-baseline-doc.js'

export interface MilestoneCompletionNudge {
  actions: string[]
  message: string | null
  milestone: string
}

const readOptionalFile = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : '')

const sectionLines = (content: string, heading: RegExp) => {
  const lines = content.split(/\r?\n/)
  const startIndex = lines.findIndex((line) => heading.test(line.trim()))
  if (startIndex === -1) return []
  const result: string[] = []
  for (const line of lines.slice(startIndex + 1)) {
    if (/^##\s+/.test(line.trim())) break
    result.push(line)
  }
  return result
}

const hasInProgressMilestoneReference = (workspacePath: string, milestone: string) => {
  const tasks = readOptionalFile(join(workspacePath, '.hive', 'tasks.md'))
  const milestonePattern = new RegExp(`\\b${milestone}\\b`, 'iu')
  return sectionLines(tasks, /^##\s+In progress\b/i).some((line) => milestonePattern.test(line))
}

const buildMessage = (event: MilestoneShippedEvent, actions: string[]) =>
  [
    '[Hive 系统消息：milestone 完成 housekeeping]',
    `${event.milestone} 已标记 shipped。请完成以下维护动作：`,
    ...actions.map((action, index) => `${index + 1}. ${action}`),
    '',
    '这是 plan.md shipped 状态变化触发的自动提醒；只跑一次，不要重复 review。',
  ].join('\n')

export function buildMilestoneCompletionNudge(
  event: MilestoneShippedEvent,
  workspacePath: string
): MilestoneCompletionNudge {
  const actions: string[] = []
  if (hasInProgressMilestoneReference(workspacePath, event.milestone)) {
    actions.push(`tasks.md：将 ${event.milestone} 相关 dispatch 行归档到 Done 段`)
    actions.push(
      `narrative 更新：In Progress 段移除 ${event.milestone} 引用，更新为下一个活跃 milestone`
    )
  }

  const baseline = parseBaselineDoc(join(workspacePath, '.hive', 'baseline'))
  if (baseline.staleHint) {
    actions.push(
      `baseline 体检：检查 module-map.md / test-gates.md 是否需要更新（${baseline.staleHint}）`
    )
  }

  if (!event.commitHash) {
    actions.push(`plan.md：确认 ${event.milestone} shipped 行包含 commit hash`)
  }

  return {
    actions,
    message: actions.length ? buildMessage(event, actions) : null,
    milestone: event.milestone,
  }
}
