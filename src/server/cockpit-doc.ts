import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { type ParsedPlan, parsePlanDoc } from './plan-doc.js'
import { type ParsedArchive, parseArchiveDoc } from './pm-archive-doc.js'
import { type ParsedBaseline, parseBaselineDoc } from './pm-baseline-doc.js'
import { type ParsedDecisions, parseDecisionsDoc } from './pm-decisions-doc.js'
import { type ParsedIdeas, type PMIdea, parseIdeasDoc } from './pm-ideas-doc.js'
import {
  type ParsedQuestions,
  type PMQuestion,
  type PMQuestionPriority,
  parseQuestionsDoc,
} from './pm-questions-doc.js'
import { detectOrphanReports, type OrphanReport } from './pm-reports-orphan-detector.js'
import { type ParsedResearch, parseResearchDoc } from './pm-research-doc.js'
import { type ParsedTasks, parseTasksDoc } from './pm-tasks-doc.js'
import { ensurePmDocs, HIVE_DIR_NAME } from './tasks-file.js'

export type AIActionType = 'question' | 'promote' | 'decision' | 'audit' | 'playbook'
export type CockpitTargetTab =
  | 'tasks'
  | 'questions'
  | 'ideas'
  | 'decisions'
  | 'baseline'
  | 'research'

export interface AIAction {
  action: string
  id: string
  priority: PMQuestionPriority
  targetTab: CockpitTargetTab
  text: string
  type: AIActionType
}

export interface ParsedCockpit {
  aiActions: AIAction[]
  archive: ParsedArchive
  baseline: ParsedBaseline
  decisions: ParsedDecisions
  generatedAt: number
  ideas: ParsedIdeas
  plan: ParsedPlan
  questions: ParsedQuestions
  research: ParsedResearch
  tasks: ParsedTasks
}

const readOptionalFile = (filePath: string) =>
  existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''

const actionPriorityRank: Record<PMQuestionPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

const questionAction = (question: PMQuestion): AIAction => ({
  action: '回答',
  id: question.id,
  priority: question.priority,
  targetTab: 'questions',
  text: question.text,
  type: 'question',
})

const isRecentIdea = (idea: PMIdea, now = Date.now()) => {
  if (!idea.addedAt) return false
  const timestamp = Date.parse(`${idea.addedAt}T00:00:00Z`)
  if (Number.isNaN(timestamp)) return false
  return now - timestamp <= 7 * 24 * 60 * 60 * 1000
}

const cancelledDispatchPattern =
  /^-\s+\[~\]\s+\*\*(.+?)\*\*\s+dispatch\s+`([0-9a-fA-F-]{8})`\s+—\s+(.+)$/gmu
const reportedDispatchPattern =
  /^-\s+\[x\]\s+\*\*(.+?)\*\*\s+dispatch\s+`([0-9a-fA-F-]{8})`\s+—\s+(.+)$/gmu
const blockedOrFailedPattern = /\b(blocked|failed|failure|failing|stuck)\b|阻塞|失败|未通过/iu
const verifierRetryPattern =
  /\b(verifier|verify|test|tests|check|build|e2e|lint|tsc|vitest|pnpm|ready|retry|retries)\b|验证|检查|测试|跑测|重试|通过/iu
const researchOnlyPattern = /调研|research|investigate/iu

const handoffPlaybookActions = (tasks: ParsedTasks): AIAction[] => {
  const actions: AIAction[] = []
  for (const match of tasks.raw.matchAll(cancelledDispatchPattern)) {
    const workerName = match[1]?.trim()
    const dispatchShortId = match[2]?.trim()
    const summary = match[3]?.trim()
    if (!workerName || !dispatchShortId || !summary) continue
    actions.push({
      action: '准备',
      id: `handoff:${dispatchShortId}`,
      priority: 'medium',
      targetTab: 'tasks',
      text: `准备 handoff brief：${workerName} dispatch ${dispatchShortId} 已取消/接手中 — ${summary}`,
      type: 'playbook',
    })
  }
  return actions.slice(0, 2)
}

const loopPlaybookActions = (tasks: ParsedTasks): AIAction[] => {
  const actions: AIAction[] = []
  for (const match of tasks.raw.matchAll(reportedDispatchPattern)) {
    const workerName = match[1]?.trim()
    const dispatchShortId = match[2]?.trim()
    const summary = match[3]?.trim()
    if (!workerName || !dispatchShortId || !summary) continue
    if (!blockedOrFailedPattern.test(summary)) continue
    if (!verifierRetryPattern.test(summary)) continue
    if (researchOnlyPattern.test(summary)) continue
    actions.push({
      action: '准备',
      id: `loop:${dispatchShortId}`,
      priority: 'medium',
      targetTab: 'tasks',
      text: `准备 loop brief：${workerName} dispatch ${dispatchShortId} 需要有界 verifier 重试 — ${summary}`,
      type: 'playbook',
    })
  }
  return actions.slice(0, 2)
}

const buildAiActions = (
  questions: ParsedQuestions,
  ideas: ParsedIdeas,
  baseline: ParsedBaseline,
  decisions: ParsedDecisions,
  tasks: ParsedTasks,
  orphanReports: OrphanReport[] = []
): AIAction[] => {
  const actions: AIAction[] = [
    ...questions.high.map(questionAction),
    ...questions.medium.map(questionAction),
    ...orphanReports.map((orphan) => {
      const reportFilename = orphan.reportPath.split('/').pop() ?? orphan.reportPath
      const researchFilename =
        orphan.suggestedResearchPath.split('/').pop() ?? orphan.suggestedResearchPath
      return {
        action: '补 note',
        id: `orphan-report:${reportFilename}`,
        priority: 'high' as const,
        targetTab: 'research' as const,
        text: `reports/${reportFilename} 缺对应 research/note。PM 规则要求调研类工作 reports/ + research/ 必须并存；用 templates/research.template.md 起手补 research/${researchFilename}`,
        type: 'audit' as const,
      }
    }),
    ...ideas.inbox
      .filter((idea) => isRecentIdea(idea))
      .slice(0, 3)
      .map((idea) => ({
        action: '查看',
        id: idea.id,
        priority: 'medium' as const,
        targetTab: 'ideas' as const,
        text: idea.text,
        type: 'promote' as const,
      })),
    ...decisions.drafts.map((decision) => ({
      action: '确认',
      id: decision.filename,
      priority: 'high' as const,
      targetTab: 'decisions' as const,
      text: decision.title,
      type: 'decision' as const,
    })),
    ...handoffPlaybookActions(tasks),
    ...loopPlaybookActions(tasks),
  ]
  if (baseline.staleHint) {
    actions.push({
      action: '查看',
      id: 'baseline-stale',
      priority: 'medium',
      targetTab: 'baseline',
      text: baseline.staleHint,
      type: 'audit',
    })
  }
  return actions
    .sort((left, right) => actionPriorityRank[left.priority] - actionPriorityRank[right.priority])
    .slice(0, 10)
}

export const parseCockpit = (workspacePath: string): ParsedCockpit => {
  ensurePmDocs(workspacePath)
  const hiveDir = join(workspacePath, HIVE_DIR_NAME)
  const plan = parsePlanDoc(readOptionalFile(join(hiveDir, 'plan.md')))
  const questions = parseQuestionsDoc(readOptionalFile(join(hiveDir, 'open-questions.md')))
  const tasks = parseTasksDoc(readOptionalFile(join(hiveDir, 'tasks.md')))
  const ideas = parseIdeasDoc(readOptionalFile(join(hiveDir, 'ideas', 'inbox.md')))
  const baseline = parseBaselineDoc(join(hiveDir, 'baseline'))
  const decisions = parseDecisionsDoc(join(hiveDir, 'decisions'))
  const research = parseResearchDoc(join(hiveDir, 'research'))
  const orphanReports = detectOrphanReports(hiveDir)
  const archive = parseArchiveDoc(join(hiveDir, 'archive'))
  return {
    aiActions: buildAiActions(questions, ideas, baseline, decisions, tasks, orphanReports),
    archive,
    baseline,
    decisions,
    generatedAt: Date.now(),
    ideas,
    plan,
    questions,
    research,
    tasks,
  }
}
