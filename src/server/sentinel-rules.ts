import type { TeamListItem } from '../shared/types.js'
import { type DispatchRecord, isOpenDispatchStatus } from './dispatch-ledger-store.js'

export type SentinelAlertTier = 'critical' | 'info' | 'warn'
export type SentinelRuleId = 'R1' | 'R2' | 'R4'

export interface SentinelAlert {
  dedupeKey: string
  detail: string
  ruleId: SentinelRuleId
  suggestedAction: string
  tier: SentinelAlertTier
  title: string
  workspaceId: string
}

export interface SentinelSpawnFailure {
  command: string
  createdAt: number
  error: string
  path: string
  workerId: string
  workerName: string
  workspaceId: string
}

export interface EvaluateSentinelRulesInput {
  dispatches: DispatchRecord[]
  now: number
  spawnFailures: SentinelSpawnFailure[]
  workers: TeamListItem[]
}

const REPORT_OVERDUE_CRITICAL_MS = 10 * 60_000
const ORPHAN_WARN_MS = 15 * 60_000
const ORPHAN_CRITICAL_MS = 30 * 60_000
const SPAWN_FAILURE_WINDOW_MS = 5 * 60_000

const minutes = (ms: number) => Math.floor(ms / 60_000)

export const evaluateSentinelRules = ({
  dispatches,
  now,
  spawnFailures,
  workers,
}: EvaluateSentinelRulesInput): SentinelAlert[] => {
  const alerts: SentinelAlert[] = []
  const workerById = new Map(workers.map((worker) => [worker.id, worker]))
  const recentFailuresByWorker = new Map<string, SentinelSpawnFailure[]>()
  for (const failure of spawnFailures) {
    if (now - failure.createdAt > SPAWN_FAILURE_WINDOW_MS) continue
    const failures = recentFailuresByWorker.get(failure.workerId) ?? []
    failures.push(failure)
    recentFailuresByWorker.set(failure.workerId, failures)
  }

  for (const [workerId, failures] of recentFailuresByWorker) {
    const latest = failures.reduce((newest, current) =>
      current.createdAt > newest.createdAt ? current : newest
    )
    const tier = failures.length >= 2 ? 'critical' : 'warn'
    alerts.push({
      dedupeKey: `${latest.workspaceId}:R1:${workerId}:spawn_failed`,
      detail: [
        `worker=${latest.workerName}`,
        `command=${latest.command}`,
        `error=${latest.error}`,
        `PATH=${latest.path}`,
        `failures_in_5m=${failures.length}`,
      ].join(' '),
      ruleId: 'R1',
      suggestedAction: `检查 ${latest.workerName} 的启动命令和 PATH；确认 ${latest.command} 已安装且在服务端 PATH 中。`,
      tier,
      title: `派单启动失败：${latest.workerName}`,
      workspaceId: latest.workspaceId,
    })
  }

  for (const dispatch of dispatches) {
    if (dispatch.status !== 'report_overdue' || dispatch.submittedAt === null) continue
    const age = now - dispatch.submittedAt
    const worker = workerById.get(dispatch.toAgentId)
    const tier = age >= REPORT_OVERDUE_CRITICAL_MS ? 'critical' : 'warn'
    alerts.push({
      dedupeKey: `${dispatch.workspaceId}:R2:${dispatch.id}`,
      detail: `dispatch=${dispatch.id} worker=${worker?.name ?? dispatch.toAgentId} report_overdue_for=${minutes(age)}m task="${dispatch.text.slice(0, 120)}"`,
      ruleId: 'R2',
      suggestedAction: `执行 team recover ${dispatch.id} 或 team abandon ${dispatch.id}，先确认 worker 当前终端状态。`,
      tier,
      title: `dispatch report_overdue：${worker?.name ?? dispatch.toAgentId}`,
      workspaceId: dispatch.workspaceId,
    })
  }

  for (const dispatch of dispatches) {
    if (!isOpenDispatchStatus(dispatch.status) || dispatch.submittedAt === null) continue
    const worker = workerById.get(dispatch.toAgentId)
    if (worker?.status !== 'stopped') continue
    const age = now - dispatch.submittedAt
    if (age < ORPHAN_WARN_MS) continue
    const tier = age >= ORPHAN_CRITICAL_MS ? 'critical' : 'warn'
    alerts.push({
      dedupeKey: `${dispatch.workspaceId}:R4:${dispatch.id}`,
      detail: `dispatch=${dispatch.id} worker=${worker.name} worker_status=stopped open_for=${minutes(age)}m task="${dispatch.text.slice(0, 120)}"`,
      ruleId: 'R4',
      suggestedAction: `worker 已 stopped 但 dispatch 仍 open；确认是否 orphan 后 recover/abandon 或重派。`,
      tier,
      title: `worker 已停但 dispatch 未收尾：${worker.name}`,
      workspaceId: dispatch.workspaceId,
    })
  }

  return alerts.sort((left, right) => {
    const tierRank: Record<SentinelAlertTier, number> = { critical: 0, warn: 1, info: 2 }
    return (
      tierRank[left.tier] - tierRank[right.tier] || left.dedupeKey.localeCompare(right.dedupeKey)
    )
  })
}
