import type { AgentManager } from './agent-manager.js'
import type { AgentLaunchConfigInput } from './agent-run-store.js'
import type { LiveAgentRun } from './agent-runtime-types.js'
import type { ParsedCockpit } from './cockpit-doc.js'
import { buildCompactRecoveryReplayInput } from './compact-recovery-watchdog.js'
import type { DispatchRecord } from './dispatch-ledger-store.js'
import {
  buildOrchestratorReminderTail,
  buildWorkerReminderTail,
  PM_DISPATCH_REMINDER,
} from './hive-team-guidance.js'
import { PtyInactiveError } from './http-errors.js'
import type { LiveRunRegistry } from './live-run-registry.js'
import { createPostStartInputWriter } from './post-start-input-writer.js'

interface AgentStdinDispatcherInput {
  agentManager: AgentManager | undefined
  getLaunchConfig: (workspaceId: string, agentId: string) => AgentLaunchConfigInput | undefined
  listAgents?: (workspaceId: string) => readonly { name: string; workflowAllowed?: boolean }[]
  getWorkspaceId: (agentId: string) => string | undefined
  registry: LiveRunRegistry
  syncRun: (run: LiveAgentRun) => LiveAgentRun
}

export const buildOrchestratorReportPayload = (
  workerName: string,
  text: string,
  artifacts: string[],
  workflowAgentNames: readonly string[] = []
): string => {
  const lines: string[] = [`[Hive 系统消息：来自 @${workerName} 的汇报]`, text]
  for (const artifact of artifacts) lines.push(`artifact: ${artifact}`)
  lines.push('', buildOrchestratorReminderTail(workflowAgentNames), '')
  return lines.join('\n')
}

export const buildOrchestratorStatusPayload = (
  workerName: string,
  text: string,
  artifacts: string[],
  workflowAgentNames: readonly string[] = []
): string => {
  const lines: string[] = [`[Hive 系统消息：来自 @${workerName} 的状态更新]`, text]
  for (const artifact of artifacts) lines.push(`artifact: ${artifact}`)
  lines.push('', buildOrchestratorReminderTail(workflowAgentNames), '')
  return lines.join('\n')
}

export const buildOrchestratorUserInputPayload = (
  text: string,
  workflowAgentNames: readonly string[] = []
): string => [text, '', buildOrchestratorReminderTail(workflowAgentNames), ''].join('\n')

const summarizeQuestionAnswer = (answer: string) => {
  const normalized = answer.trim().replace(/\s+/g, ' ')
  if (normalized.length <= 240) return normalized
  return `${normalized.slice(0, 237)}...`
}

export const buildOrchestratorQuestionAnsweredPayload = (
  questionId: string,
  answer: string,
  workflowAgentNames: readonly string[] = []
): string =>
  [
    '[Hive 系统消息：PM question 已被 user 答复]',
    `question_id: ${questionId}`,
    `answer_summary: ${summarizeQuestionAnswer(answer)}`,
    '',
    '请重读 .hive/open-questions.md，并根据 user 的答复决定后续行动。',
    '这不是新 dispatch；这是 Cockpit Questions tab 的 human-in-the-loop 回答唤醒。',
    '',
    buildOrchestratorReminderTail(workflowAgentNames),
    '',
  ].join('\n')

export const buildOrchestratorTasksNarrativeNudgePayload = (
  message: string,
  workflowAgentNames: readonly string[] = []
): string => [message, '', buildOrchestratorReminderTail(workflowAgentNames), ''].join('\n')

export const buildWorkerCockpitSnapshot = (cockpit: ParsedCockpit): string => {
  const phase = cockpit.plan.frontmatter.current_phase ?? cockpit.plan.currentPhase ?? 'unknown'
  const activeMilestone =
    cockpit.plan.milestones.find((milestone) => milestone.status === 'in_progress') ??
    cockpit.plan.milestones.find((milestone) => milestone.status !== 'shipped')
  const active = activeMilestone
    ? `${activeMilestone.id} ${activeMilestone.title} (${activeMilestone.status})`
    : 'none'
  const openQuestions =
    cockpit.questions.high.length + cockpit.questions.medium.length + cockpit.questions.low.length
  const highAiActions = cockpit.aiActions.filter((action) => action.priority === 'high').length
  const baseline = cockpit.baseline.staleHint ? 'stale' : 'fresh'
  return [
    '**Cockpit snapshot（dispatch 时）**',
    `- phase: ${phase}; active: ${active}`,
    `- open_questions: ${openQuestions} (high ${cockpit.questions.high.length}); high_ai_actions: ${highAiActions}; baseline: ${baseline}`,
    '- PM co-maintain: pair reports with research; only stage your files; commit your own changes when asked.',
  ].join('\n')
}

export const buildWorkerDispatchPayload = (
  fromAgentName: string,
  workerDescription: string,
  dispatchId: string,
  text: string,
  cockpitSnapshot?: string,
  workerCapabilitySummary?: string,
  input: { workflowAllowed?: boolean } = {}
): string =>
  [
    `[Hive 系统消息：来自 @${fromAgentName} 的派单]`,
    '',
    `你的角色：${workerDescription}`,
    '',
    '你必须遵守：',
    `- 完成、失败、阻塞或部分完成后，执行 \`team report "<result>" --dispatch ${dispatchId}\``,
    '- 不要做无关的事，做完就 report',
    '',
    `dispatch_id: ${dispatchId}`,
    '',
    '任务内容：',
    text,
    '',
    PM_DISPATCH_REMINDER,
    '',
    ...(workerCapabilitySummary?.trim()
      ? ['**Worker capability manifest（runtime 推导）**', workerCapabilitySummary.trim(), '']
      : []),
    ...(cockpitSnapshot?.trim() ? [cockpitSnapshot.trim(), ''] : []),
    buildWorkerReminderTail(dispatchId, {
      workflowAllowed: input.workflowAllowed === true,
    }),
    '',
  ].join('\n')

export const buildWorkerCancelPayload = (dispatchId: string, reason: string): string =>
  [
    `[Hive 系统消息：dispatch ${dispatchId} 已取消]`,
    '',
    '请停止执行这条派单，不要再为它调用 team report。',
    '',
    '取消原因：',
    reason,
    '',
  ].join('\n')

export const createAgentStdinDispatcher = ({
  agentManager,
  getLaunchConfig,
  listAgents,
  getWorkspaceId,
  registry,
  syncRun,
}: AgentStdinDispatcherInput) => {
  const workflowAgentNamesForWorkspace = (workspaceId: string): string[] =>
    (listAgents?.(workspaceId) ?? [])
      .filter((agent) => agent.workflowAllowed === true)
      .map((agent) => agent.name)

  const writeToActiveAgentRun = (
    workspaceId: string,
    agentId: string,
    text: string,
    input: { requireActiveRun?: boolean } = {}
  ) => {
    const run = registry
      .list()
      .filter((item) => item.agentId === agentId && getWorkspaceId(item.agentId) === workspaceId)
      .sort((left, right) => right.startedAt - left.startedAt)
      .find((item) => {
        const status = syncRun(item).status
        return status === 'starting' || status === 'running'
      })
    if (!run) {
      if (input.requireActiveRun) {
        throw new PtyInactiveError(`No active run for agent: ${agentId}`)
      }
      return
    }

    try {
      const config = getLaunchConfig(workspaceId, agentId)
      if (agentManager && config) {
        createPostStartInputWriter(agentManager, config.interactiveCommand ?? config.command)(
          run.runId,
          text
        )
      } else {
        agentManager?.writeInput(run.runId, text)
      }
    } catch (error) {
      throw new PtyInactiveError(error instanceof Error ? error.message : String(error))
    }
  }

  return {
    writeReportPrompt(
      workspaceId: string,
      workerName: string,
      text: string,
      artifacts: string[],
      input: { requireActiveRun?: boolean } = {}
    ) {
      writeToActiveAgentRun(
        workspaceId,
        `${workspaceId}:orchestrator`,
        buildOrchestratorReportPayload(
          workerName,
          text,
          artifacts,
          workflowAgentNamesForWorkspace(workspaceId)
        ),
        input
      )
    },
    writeStatusPrompt(
      workspaceId: string,
      workerName: string,
      text: string,
      artifacts: string[],
      input: { requireActiveRun?: boolean } = {}
    ) {
      writeToActiveAgentRun(
        workspaceId,
        `${workspaceId}:orchestrator`,
        buildOrchestratorStatusPayload(
          workerName,
          text,
          artifacts,
          workflowAgentNamesForWorkspace(workspaceId)
        ),
        input
      )
    },
    writeQuestionAnsweredPrompt(
      workspaceId: string,
      questionId: string,
      answer: string,
      input: { requireActiveRun?: boolean } = {}
    ) {
      writeToActiveAgentRun(
        workspaceId,
        `${workspaceId}:orchestrator`,
        buildOrchestratorQuestionAnsweredPayload(
          questionId,
          answer,
          workflowAgentNamesForWorkspace(workspaceId)
        ),
        input
      )
    },
    writeTasksNarrativeNudgePrompt(
      workspaceId: string,
      message: string,
      input: { requireActiveRun?: boolean } = {}
    ) {
      writeToActiveAgentRun(
        workspaceId,
        `${workspaceId}:orchestrator`,
        buildOrchestratorTasksNarrativeNudgePayload(
          message,
          workflowAgentNamesForWorkspace(workspaceId)
        ),
        input
      )
    },
    writeSendPrompt(
      workspaceId: string,
      workerId: string,
      dispatchId: string,
      fromAgentName: string,
      workerDescription: string,
      text: string,
      cockpitSnapshot?: string,
      workerCapabilitySummary?: string,
      input: { workflowAllowed?: boolean } = {}
    ) {
      writeToActiveAgentRun(
        workspaceId,
        workerId,
        buildWorkerDispatchPayload(
          fromAgentName,
          workerDescription,
          dispatchId,
          text,
          cockpitSnapshot,
          workerCapabilitySummary,
          input
        ),
        { requireActiveRun: true }
      )
    },
    writeRecoveryReplayPrompt(workspaceId: string, workerId: string, dispatch: DispatchRecord) {
      writeToActiveAgentRun(workspaceId, workerId, buildCompactRecoveryReplayInput(dispatch), {
        requireActiveRun: true,
      })
    },
    writeCancelPrompt(
      workspaceId: string,
      workerId: string,
      dispatchId: string,
      reason: string,
      input: { requireActiveRun?: boolean } = {}
    ) {
      writeToActiveAgentRun(
        workspaceId,
        workerId,
        buildWorkerCancelPayload(dispatchId, reason),
        input
      )
    },
    writeUserInputPrompt(workspaceId: string, text: string) {
      writeToActiveAgentRun(
        workspaceId,
        `${workspaceId}:orchestrator`,
        buildOrchestratorUserInputPayload(text, workflowAgentNamesForWorkspace(workspaceId))
      )
    },
  }
}
