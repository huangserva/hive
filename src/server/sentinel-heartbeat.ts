import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { join } from 'node:path'

import type { TeamListItem, WorkspaceSummary } from '../shared/types.js'
import { type ArchiveAuditFinding, createArchiveAuditTrigger } from './archive-audit-trigger.js'
import { parseCockpit } from './cockpit-doc.js'
import { auditCockpitFidelity, type CockpitFidelityFindings } from './cockpit-fidelity-audit.js'
import {
  type CrossWorkspaceDriftFinding,
  detectCrossWorkspaceDrift,
} from './cross-workspace-drift.js'
import type { DispatchRecord } from './dispatch-ledger-store.js'
import type { HiveLogger } from './logger.js'
import { parseDecisionsDoc } from './pm-decisions-doc.js'
import { buildSentinelHeartbeatPayload } from './sentinel-guidance.js'
import type { WorkerConfig } from './workspace-store.js'

const DEFAULT_CHECK_INTERVAL_MS = 60 * 1000
const DEFAULT_SENTINEL_HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000
const STALE_SUBMITTED_DISPATCH_MS = 15 * 60 * 1000
const STALE_WORKING_DISPATCH_MS = 30 * 60 * 1000
export const STALE_DECISION_DRAFT_MS = 48 * 60 * 60 * 1000

type ActiveRunRef = { runId: string } | undefined

export interface StaleDecisionDraft {
  daysAgo: number
  filename: string
  title: string
}

export interface SentinelHeartbeatOptions {
  buildCockpitSnapshot?: (workspacePath: string) => unknown
  detectCrossWorkspaceDrift?: (workspaces: WorkspaceSummary[]) => CrossWorkspaceDriftFinding[]
  getActiveRunByAgentId: (workspaceId: string, agentId: string) => ActiveRunRef
  getGitSummary?: (workspacePath: string) => string
  getWorkerConfig: (workspaceId: string, workerId: string) => WorkerConfig
  inspectCockpitFidelity?: (workspacePath: string) => CockpitFidelityFindings
  inspectArchiveAudit?: (workspacePath: string) => ArchiveAuditFinding[]
  intervalMs?: number
  listOpenDispatches?: (workspaceId: string) => DispatchRecord[]
  listWorkers: (workspaceId: string) => TeamListItem[]
  listWorkspaces: () => WorkspaceSummary[]
  logger?: HiveLogger
  now?: () => number
  reconcileAgentStatus?: (workspaceId: string, agentId: string) => void
  writeRunInput: (runId: string, input: string) => void
}

const summarizeCockpit = (snapshot: unknown): string => {
  if (!snapshot || typeof snapshot !== 'object') return 'unavailable'
  const record = snapshot as Record<string, unknown>
  const questions = record.questions as { high?: unknown[]; medium?: unknown[]; low?: unknown[] }
  const aiActions = Array.isArray(record.aiActions) ? record.aiActions : []
  const baseline = record.baseline as { staleHint?: string | null } | undefined
  const openQuestions =
    typeof record.openQuestions === 'number'
      ? record.openQuestions
      : (questions?.high?.length ?? 0) +
        (questions?.medium?.length ?? 0) +
        (questions?.low?.length ?? 0)
  const highAiActions = aiActions.filter(
    (item) =>
      item && typeof item === 'object' && (item as { priority?: unknown }).priority === 'high'
  ).length
  const baselineState =
    typeof record.baselineStale === 'boolean'
      ? record.baselineStale
        ? 'stale'
        : 'fresh'
      : baseline?.staleHint
        ? `stale: ${baseline.staleHint}`
        : 'unknown'
  return [
    `open_questions=${openQuestions}`,
    `high_ai_actions=${highAiActions}`,
    `baseline=${baselineState}`,
  ].join('\n')
}

const defaultBuildCockpitSnapshot = (workspacePath: string): unknown => parseCockpit(workspacePath)

const defaultGetGitSummary = (workspacePath: string): string => {
  try {
    const status = execFileSync('git', ['-C', workspacePath, 'status', '--short'], {
      encoding: 'utf8',
      timeout: 5000,
    }).trim()
    const log = execFileSync('git', ['-C', workspacePath, 'log', '--oneline', '-5'], {
      encoding: 'utf8',
      timeout: 5000,
    }).trim()
    return [`status: ${status || 'clean'}`, 'recent commits:', log || '(none)'].join('\n')
  } catch (error) {
    return `git summary unavailable: ${error instanceof Error ? error.message : String(error)}`
  }
}

const dateFromDecisionDraft = (raw: string) => {
  const match = /(?:\*\*日期\*\*|date)\s*[:：]\s*(\d{4}-\d{2}-\d{2})/iu.exec(raw)
  if (!match?.[1]) return null
  const timestamp = Date.parse(`${match[1]}T00:00:00Z`)
  return Number.isFinite(timestamp) ? timestamp : null
}

export const listStaleDecisionDrafts = (
  workspacePath: string,
  tickedAt: number,
  staleDraftMs = STALE_DECISION_DRAFT_MS
): StaleDecisionDraft[] => {
  const decisionsDir = join(workspacePath, '.hive', 'decisions')
  return parseDecisionsDoc(decisionsDir)
    .drafts.map((draft) => {
      const datedAt =
        dateFromDecisionDraft(draft.raw) ??
        statSync(join(decisionsDir, draft.filename), { throwIfNoEntry: false })?.mtimeMs ??
        tickedAt
      return {
        ageMs: tickedAt - datedAt,
        daysAgo: Math.floor((tickedAt - datedAt) / (24 * 60 * 60 * 1000)),
        filename: draft.filename,
        title: draft.title,
      }
    })
    .filter((draft) => draft.ageMs >= staleDraftMs)
    .map(({ ageMs: _ageMs, ...draft }) => draft)
}

export const createSentinelHeartbeat = ({
  buildCockpitSnapshot = defaultBuildCockpitSnapshot,
  detectCrossWorkspaceDrift: detectCrossWorkspaceDriftForHeartbeat = detectCrossWorkspaceDrift,
  getActiveRunByAgentId,
  getGitSummary = defaultGetGitSummary,
  getWorkerConfig,
  inspectCockpitFidelity = auditCockpitFidelity,
  inspectArchiveAudit,
  intervalMs = DEFAULT_CHECK_INTERVAL_MS,
  listOpenDispatches = () => [],
  listWorkers,
  listWorkspaces,
  logger,
  now = Date.now,
  reconcileAgentStatus,
  writeRunInput,
}: SentinelHeartbeatOptions) => {
  let timer: ReturnType<typeof setInterval> | null = null
  const lastTickAt = new Map<string, number>()
  const archiveAuditTrigger = createArchiveAuditTrigger()

  const getHeartbeatIntervalMs = (workspaceId: string, workerId: string) => {
    const configured = getWorkerConfig(workspaceId, workerId).heartbeat_interval_ms
    return typeof configured === 'number' && Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_SENTINEL_HEARTBEAT_INTERVAL_MS
  }

  const listOrphanedDispatches = (
    workspaceId: string,
    workers: TeamListItem[],
    tickedAt: number
  ) => {
    const workersById = new Map(workers.map((worker) => [worker.id, worker]))
    return listOpenDispatches(workspaceId)
      .filter((dispatch) => {
        if (dispatch.submittedAt === null) return false
        const workerStatus = workersById.get(dispatch.toAgentId)?.status
        if (workerStatus === 'stopped') {
          return tickedAt - dispatch.submittedAt >= STALE_SUBMITTED_DISPATCH_MS
        }
        if (workerStatus === 'working' || workerStatus === 'idle') {
          return tickedAt - dispatch.submittedAt >= STALE_WORKING_DISPATCH_MS
        }
        return false
      })
      .map((dispatch) => {
        const worker = workersById.get(dispatch.toAgentId)
        return {
          dispatchId: dispatch.id,
          minutesAgo: Math.floor((tickedAt - (dispatch.submittedAt ?? tickedAt)) / 60_000),
          workerName: worker?.name ?? dispatch.toAgentId,
        }
      })
  }

  const tick = async () => {
    const tickedAt = now()
    const workspaces = listWorkspaces()
    const crossWorkspaceDriftFindings = detectCrossWorkspaceDriftForHeartbeat(workspaces).map(
      (finding) => finding.message
    )
    for (const workspace of workspaces) {
      const workers = listWorkers(workspace.id)
      for (const worker of workers) {
        try {
          reconcileAgentStatus?.(workspace.id, worker.id)
        } catch (error) {
          logger?.warn(
            `agent status reconcile failed workspace_id=${workspace.id} agent_id=${worker.id}`,
            error
          )
        }
      }
      const sentinels = workers.filter((worker) => worker.role === 'sentinel')
      for (const sentinel of sentinels) {
        const run = getActiveRunByAgentId(workspace.id, sentinel.id)
        if (!run) continue
        try {
          const heartbeatKey = `${workspace.id}:${sentinel.id}`
          const previousTickAt = lastTickAt.get(heartbeatKey)
          if (
            previousTickAt !== undefined &&
            tickedAt - previousTickAt < getHeartbeatIntervalMs(workspace.id, sentinel.id)
          ) {
            continue
          }
          const payload = buildSentinelHeartbeatPayload({
            archiveAuditFindings: (inspectArchiveAudit
              ? inspectArchiveAudit(workspace.path)
              : archiveAuditTrigger.check(workspace.path)
            ).map((finding) => finding.message),
            cockpitFidelityFindings: inspectCockpitFidelity(workspace.path).findings,
            cockpitSummary: summarizeCockpit(buildCockpitSnapshot(workspace.path)),
            crossWorkspaceDriftFindings,
            gitSummary: getGitSummary(workspace.path),
            orphanedDispatches: listOrphanedDispatches(workspace.id, workers, tickedAt),
            staleDecisionDrafts: listStaleDecisionDrafts(workspace.path, tickedAt),
            workspace,
          })
          writeRunInput(run.runId, payload)
          lastTickAt.set(heartbeatKey, tickedAt)
        } catch (error) {
          logger?.warn(
            `sentinel heartbeat failed workspace_id=${workspace.id} agent_id=${sentinel.id}`,
            error
          )
        }
      }
    }
  }

  const start = () => {
    if (timer) return
    const nextTimer = setInterval(() => {
      void tick()
    }, intervalMs)
    timer = nextTimer
    ;(nextTimer as { unref?: () => void }).unref?.()
  }

  const stop = () => {
    if (!timer) return
    clearInterval(timer)
    timer = null
  }

  return { close: stop, start, stop, tick }
}
