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
import { type ParsedResearch, parseResearchDoc } from './pm-research-doc.js'
import { type ParsedTasks, parseTasksDoc } from './pm-tasks-doc.js'
import { ensurePmDocs, HIVE_DIR_NAME } from './tasks-file.js'

export type AIActionType = 'question' | 'promote' | 'decision' | 'audit'
export type CockpitTargetTab = 'questions' | 'ideas' | 'decisions' | 'baseline'

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

const buildAiActions = (
  questions: ParsedQuestions,
  ideas: ParsedIdeas,
  baseline: ParsedBaseline,
  decisions: ParsedDecisions
): AIAction[] => {
  const actions: AIAction[] = [
    ...questions.high.map(questionAction),
    ...questions.medium.map(questionAction),
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
  const archive = parseArchiveDoc(join(hiveDir, 'archive'))
  return {
    aiActions: buildAiActions(questions, ideas, baseline, decisions),
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
