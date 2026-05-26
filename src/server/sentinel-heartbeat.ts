import { execFileSync } from 'node:child_process'

import type { TeamListItem, WorkspaceSummary } from '../shared/types.js'
import { parseCockpit } from './cockpit-doc.js'
import type { HiveLogger } from './logger.js'
import { buildSentinelHeartbeatPayload } from './sentinel-guidance.js'

const DEFAULT_SENTINEL_INTERVAL_MS = 30 * 60 * 1000

type ActiveRunRef = { runId: string } | undefined

export interface SentinelHeartbeatOptions {
  buildCockpitSnapshot?: (workspacePath: string) => unknown
  getActiveRunByAgentId: (workspaceId: string, agentId: string) => ActiveRunRef
  getGitSummary?: (workspacePath: string) => string
  intervalMs?: number
  listWorkers: (workspaceId: string) => TeamListItem[]
  listWorkspaces: () => WorkspaceSummary[]
  logger?: HiveLogger
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

export const createSentinelHeartbeat = ({
  buildCockpitSnapshot = defaultBuildCockpitSnapshot,
  getActiveRunByAgentId,
  getGitSummary = defaultGetGitSummary,
  intervalMs = DEFAULT_SENTINEL_INTERVAL_MS,
  listWorkers,
  listWorkspaces,
  logger,
  writeRunInput,
}: SentinelHeartbeatOptions) => {
  let timer: NodeJS.Timeout | null = null

  const tick = async () => {
    for (const workspace of listWorkspaces()) {
      const sentinels = listWorkers(workspace.id).filter((worker) => worker.role === 'sentinel')
      for (const sentinel of sentinels) {
        const run = getActiveRunByAgentId(workspace.id, sentinel.id)
        if (!run) continue
        try {
          const payload = buildSentinelHeartbeatPayload({
            cockpitSummary: summarizeCockpit(buildCockpitSnapshot(workspace.path)),
            gitSummary: getGitSummary(workspace.path),
            workspace,
          })
          writeRunInput(run.runId, payload)
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
    timer = setInterval(() => {
      void tick()
    }, intervalMs)
    timer.unref?.()
  }

  const stop = () => {
    if (!timer) return
    clearInterval(timer)
    timer = null
  }

  return { close: stop, start, stop, tick }
}
