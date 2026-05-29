import type { AgentSummary, WorkspaceSummary } from '../shared/types.js'

import { getHiveTeamRules } from './hive-team-guidance.js'
import type { RecoveryMessage } from './message-log-store.js'
import { wrapSystemMessage } from './system-message.js'
import { TASKS_RELATIVE_PATH } from './tasks-file.js'

const TASKS_HEAD_LIMIT = 1536

const formatUserInputs = (messages: RecoveryMessage[]) => {
  const userInputs = messages.filter((message) => message.type === 'user_input')
  return userInputs.length > 0
    ? userInputs.slice(-5).map((message) => `- user: ${message.text}`)
    : ['- （最近 1 小时没有新的 user_input）']
}

const formatTaskEvents = (messages: RecoveryMessage[], agent: AgentSummary) => {
  const taskEvents = messages.filter(
    (message): message is Extract<RecoveryMessage, { type: 'send' | 'report' | 'status' }> => {
      if (agent.role === 'orchestrator') {
        if (message.type === 'send') return message.from === agent.id
        return message.type === 'report' || message.type === 'status'
      }
      if (message.type === 'send') return message.to === agent.id || message.from === agent.id
      return (message.type === 'report' || message.type === 'status') && message.from === agent.id
    }
  )
  return taskEvents.length > 0
    ? taskEvents.slice(-8).map((message) => {
        if (message.type === 'send') return `- send -> ${message.to}: ${message.text}`
        if (message.type === 'status') return `- status <- ${message.from}: ${message.text}`
        const status = message.status ? ` [${message.status}]` : ''
        return `- report <- ${message.from}${status}: ${message.text}`
      })
    : ['- （最近没有任务事件）']
}

const getOpenTaskTargets = (agent: AgentSummary, workers: AgentSummary[]) =>
  agent.role === 'orchestrator' ? workers : [agent]

export interface CancelledDispatchRef {
  text: string
  toAgentId: string
}

const formatOpenTasks = (
  messages: RecoveryMessage[],
  agent: AgentSummary,
  workers: AgentSummary[],
  cancelledDispatches: CancelledDispatchRef[] = []
) => {
  const targetAgents = getOpenTaskTargets(agent, workers).filter(
    (target) => target.role !== 'orchestrator'
  )
  const targetIds = new Set(targetAgents.map((target) => target.id))
  const queues = new Map<string, Array<Extract<RecoveryMessage, { type: 'send' }>>>()

  // 已取消 dispatch 的可消费配额：按 (worker, text) 计数。cancel 不写 message log，
  // 故这里用 dispatch ledger 的状态把对应的 send 从 open 队列里剔除，FIFO 按文本匹配消费（bug C2）。
  const cancelledRemaining = new Map<string, Map<string, number>>()
  for (const dispatch of cancelledDispatches) {
    if (!targetIds.has(dispatch.toAgentId)) continue
    const byText = cancelledRemaining.get(dispatch.toAgentId) ?? new Map<string, number>()
    byText.set(dispatch.text, (byText.get(dispatch.text) ?? 0) + 1)
    cancelledRemaining.set(dispatch.toAgentId, byText)
  }

  for (const message of messages) {
    if (message.type === 'send' && targetIds.has(message.to)) {
      const byText = cancelledRemaining.get(message.to)
      const remaining = byText?.get(message.text) ?? 0
      if (byText && remaining > 0) {
        byText.set(message.text, remaining - 1)
        continue
      }
      const queue = queues.get(message.to) ?? []
      queue.push(message)
      queues.set(message.to, queue)
      continue
    }

    if (message.type === 'report' && targetIds.has(message.from)) {
      queues.get(message.from)?.shift()
    }
  }

  const lines: string[] = []
  for (const target of targetAgents) {
    const queue = queues.get(target.id) ?? []
    for (const task of queue.slice(-8)) {
      lines.push(`- ${target.name}: ${task.text}`)
    }
    if (target.pendingTaskCount > queue.length) {
      lines.push(
        `- ${target.name}: ${target.pendingTaskCount - queue.length} 个 pending 无可恢复详情`
      )
    }
  }

  return lines.length > 0 ? lines : ['- （当前没有未完成任务）']
}

const formatWorkers = (workers: AgentSummary[]) => {
  if (workers.length === 0) return ['- 当前没有其他 worker']
  return workers.map(
    (worker) =>
      `- ${worker.name} (${worker.role}, ${worker.status}, pending_task_count: ${worker.pendingTaskCount})`
  )
}

const getTaskSectionTitle = (agent: AgentSummary) =>
  agent.role === 'orchestrator' ? '## 你已派出的任务' : '## 最近派给你的任务'

export const buildRecoverySummary = ({
  agent,
  allTaskMessages,
  cancelledDispatches,
  messages,
  tasksContent,
  workers,
  workspace,
}: {
  agent: AgentSummary
  allTaskMessages?: RecoveryMessage[]
  cancelledDispatches?: CancelledDispatchRef[]
  messages: RecoveryMessage[]
  tasksContent: string
  workers: AgentSummary[]
  workspace: WorkspaceSummary
}) =>
  wrapSystemMessage(
    [
      `你是 ${workspace.name} 的 ${agent.name}（${agent.role}）。`,
      '你刚被 Hive 重启了，且无法通过原生 session resume 恢复。下面是接力上下文。',
      '',
      '## 最近 1 小时与 user 的对话',
      ...formatUserInputs(messages),
      '',
      getTaskSectionTitle(agent),
      ...formatTaskEvents(messages, agent),
      '',
      '## 当前未完成任务',
      ...formatOpenTasks(allTaskMessages ?? messages, agent, workers, cancelledDispatches),
      '',
      `## 当前 ${TASKS_RELATIVE_PATH} 状态`,
      tasksContent.slice(0, TASKS_HEAD_LIMIT) || '(空)',
      '',
      '## 当前活跃 worker',
      ...formatWorkers(workers),
      '',
      agent.role === 'orchestrator' ? '## Hive worker 派单规则' : '## Hive worker 边界',
      ...getHiveTeamRules(agent),
      '',
      '请基于此继续。如果不确定，问 user。',
    ].join('\n')
  )
