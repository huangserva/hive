import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type { WorkspaceSummary } from '../shared/types.js'
import type { DispatchRecord } from './dispatch-ledger-store.js'
import { isActiveDispatchStatus } from './dispatch-ledger-store.js'
import type { HiveLogger } from './logger.js'

export const DEFAULT_COMPACT_WATCHDOG_INTERVAL_MS = 60 * 1000
export const DEFAULT_COMPACT_HARD_RECOVERY_MS = 12 * 60 * 1000
export const DEFAULT_COMPACT_WORKFLOW_HARD_RECOVERY_MS = 30 * 60 * 1000
export const DEFAULT_COMPACT_SOFT_PROBE_GRACE_MS = 60 * 1000

const MAX_MTIME_SCAN_FILES = 5_000
const IGNORED_PROGRESS_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.expo',
  'coverage',
])

type ActiveRunRef = { output?: string; runId: string } | undefined
type StartedRunRef = { runId: string }
export type CompactRecoveryRunStatus = string | undefined

export interface CompactProgressSnapshot {
  fingerprint: string
  gitFingerprint: string
  maxWorkspaceMtimeMs: number | null
  ptyFingerprint: string
  workflowJournalMtimeMs: number | null
}

export interface CompactRecoveryNotice {
  escalated: boolean
  minutesAgo: number
  reason?: string
}

export interface CompactRecoveryWatchdogOptions {
  autoRecoverEnabled?: boolean
  getActiveRunByAgentId: (workspaceId: string, agentId: string) => ActiveRunRef
  getHardRecoveryMs?: (dispatch: DispatchRecord) => number
  getProgressSnapshot?: (
    workspace: WorkspaceSummary,
    dispatch: DispatchRecord,
    activeRun: Exclude<ActiveRunRef, undefined>
  ) => CompactProgressSnapshot | Promise<CompactProgressSnapshot>
  getRunStatusByRunId?: (runId: string) => CompactRecoveryRunStatus
  hardRecoveryMs?: number
  intervalMs?: number
  listOpenDispatchesForWorkspace: (workspaceId: string) => DispatchRecord[]
  listWorkspaces: () => WorkspaceSummary[]
  logger?: HiveLogger
  markDispatchReportOverdue?: (dispatchId: string) => DispatchRecord | undefined
  notifyUserOfStaleDispatch?: (
    workspaceId: string,
    dispatch: DispatchRecord,
    notice: CompactRecoveryNotice
  ) => void
  now?: () => number
  softProbeGraceMs?: number
  startAgent: (workspaceId: string, agentId: string) => Promise<StartedRunRef>
  stopAgentRun: (runId: string) => void
  workflowHardRecoveryMs?: number
  writeRunInput: (runId: string, input: string) => void
}

interface DispatchWatchState {
  escalated?: boolean
  lastFingerprint: string
  lastProgressAt: number
  recoveryAttempted?: boolean
  softProbeAt?: number
}

const hashText = (value: string) => createHash('sha1').update(value).digest('hex')

const isLongRunningDispatch = (dispatch: DispatchRecord) =>
  /\bworkflow\b|idea-14|长任务|long[- ]?running|video|视频/iu.test(dispatch.text)

const scanMaxMtime = (root: string) => {
  let scanned = 0
  let maxMtimeMs: number | null = null
  const visit = (dir: string) => {
    if (scanned >= MAX_MTIME_SCAN_FILES) return
    let entries: Array<{ isDirectory: () => boolean; name: string }>
    try {
      entries = readdirSync(dir, { encoding: 'utf8', withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (scanned >= MAX_MTIME_SCAN_FILES) return
      if (entry.isDirectory() && IGNORED_PROGRESS_DIRS.has(entry.name)) continue
      const path = join(dir, entry.name)
      let stat: ReturnType<typeof statSync>
      try {
        stat = statSync(path)
      } catch {
        continue
      }
      scanned += 1
      maxMtimeMs = Math.max(maxMtimeMs ?? 0, stat.mtimeMs)
      if (entry.isDirectory()) visit(path)
    }
  }
  visit(root)
  return maxMtimeMs
}

const getGitFingerprint = (workspacePath: string) => {
  try {
    return execFileSync('git', ['-C', workspacePath, 'status', '--short'], {
      encoding: 'utf8',
      timeout: 5_000,
    }).trim()
  } catch (error) {
    return `git-unavailable:${error instanceof Error ? error.message : String(error)}`
  }
}

const statMtime = (path: string) => statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? null

export const collectWorkspaceProgressSnapshot = (
  workspace: WorkspaceSummary,
  _dispatch: DispatchRecord,
  activeRun: Exclude<ActiveRunRef, undefined>
): CompactProgressSnapshot => {
  const gitFingerprint = getGitFingerprint(workspace.path)
  const maxWorkspaceMtimeMs = scanMaxMtime(workspace.path)
  const workflowJournalMtimeMs = Math.max(
    statMtime(join(workspace.path, '.hive', 'tasks.md')) ?? 0,
    statMtime(join(workspace.path, '.hive', 'plan.md')) ?? 0,
    statMtime(join(workspace.path, '.hive', 'research')) ?? 0,
    statMtime(join(workspace.path, '.hive', 'reports')) ?? 0,
    statMtime(join(workspace.path, 'workflows')) ?? 0
  )
  const normalizedWorkflowMtime = workflowJournalMtimeMs > 0 ? workflowJournalMtimeMs : null
  const ptyFingerprint = hashText(activeRun.output ?? '')
  const fingerprint = hashText(
    JSON.stringify({
      gitFingerprint,
      maxWorkspaceMtimeMs,
      ptyFingerprint,
      workflowJournalMtimeMs: normalizedWorkflowMtime,
    })
  )
  return {
    fingerprint,
    gitFingerprint,
    maxWorkspaceMtimeMs,
    ptyFingerprint,
    workflowJournalMtimeMs: normalizedWorkflowMtime,
  }
}

const buildSoftProbeInput = (dispatch: DispatchRecord) =>
  [
    '',
    `[Hive 系统消息：compact recovery soft probe] dispatch_id=${dispatch.id}`,
    '如果你仍在处理，请继续；如果已经完成、失败或阻塞，必须立即执行 team report。只写文字总结不算汇报。',
    '',
  ].join('\n')

export const buildCompactRecoveryReplayInput = (dispatch: DispatchRecord) =>
  [
    `[Hive 系统消息：compact recovery replay]`,
    '',
    `原 dispatch_id: ${dispatch.id}`,
    '',
    '你刚因长时间无实质进展被自动重启。请继续处理同一派单；完成、失败、阻塞或部分完成后，必须执行：',
    `team report "<result>" --dispatch ${dispatch.id}`,
    '',
    '原始任务内容：',
    dispatch.text,
    '',
  ].join('\n')

export const createCompactRecoveryWatchdog = ({
  autoRecoverEnabled = false,
  getActiveRunByAgentId,
  getHardRecoveryMs,
  getProgressSnapshot = collectWorkspaceProgressSnapshot,
  getRunStatusByRunId,
  hardRecoveryMs = DEFAULT_COMPACT_HARD_RECOVERY_MS,
  intervalMs = DEFAULT_COMPACT_WATCHDOG_INTERVAL_MS,
  listOpenDispatchesForWorkspace,
  listWorkspaces,
  logger,
  markDispatchReportOverdue,
  notifyUserOfStaleDispatch,
  now = Date.now,
  softProbeGraceMs = DEFAULT_COMPACT_SOFT_PROBE_GRACE_MS,
  startAgent,
  stopAgentRun,
  workflowHardRecoveryMs = DEFAULT_COMPACT_WORKFLOW_HARD_RECOVERY_MS,
  writeRunInput,
}: CompactRecoveryWatchdogOptions) => {
  let timer: ReturnType<typeof setInterval> | null = null
  const watchStateByDispatchId = new Map<string, DispatchWatchState>()

  const hardWindowFor = (dispatch: DispatchRecord) =>
    getHardRecoveryMs?.(dispatch) ??
    (isLongRunningDispatch(dispatch) ? workflowHardRecoveryMs : hardRecoveryMs)

  const notifyEscalated = (
    workspaceId: string,
    dispatch: DispatchRecord,
    reason: string,
    tickedAt: number
  ) => {
    markDispatchReportOverdue?.(dispatch.id)
    notifyUserOfStaleDispatch?.(workspaceId, dispatch, {
      escalated: true,
      minutesAgo: Math.floor((tickedAt - (dispatch.submittedAt ?? dispatch.createdAt)) / 60_000),
      reason,
    })
  }

  const isRunTerminal = (runId: string) => {
    const status = getRunStatusByRunId?.(runId)
    return status === 'exited' || status === 'error'
  }

  const recoverDispatch = async (
    workspace: WorkspaceSummary,
    dispatch: DispatchRecord,
    activeRun: Exclude<ActiveRunRef, undefined>,
    state: DispatchWatchState,
    tickedAt: number
  ) => {
    state.recoveryAttempted = true
    try {
      stopAgentRun(activeRun.runId)
      if (!isRunTerminal(activeRun.runId)) {
        state.escalated = true
        notifyEscalated(workspace.id, dispatch, 'owner_run_not_terminal', tickedAt)
        logger?.warn(
          `compact recovery skipped restart because old run is not terminal workspace_id=${workspace.id} agent_id=${dispatch.toAgentId} dispatch_id=${dispatch.id} run_id=${activeRun.runId}`
        )
        return
      }
      const newRun = await startAgent(workspace.id, dispatch.toAgentId)
      writeRunInput(newRun.runId, buildCompactRecoveryReplayInput(dispatch))
      state.lastProgressAt = tickedAt
      delete state.softProbeAt
      logger?.warn(
        `compact recovery restarted worker workspace_id=${workspace.id} agent_id=${dispatch.toAgentId} dispatch_id=${dispatch.id} old_run_id=${activeRun.runId} new_run_id=${newRun.runId}`
      )
    } catch (error) {
      state.escalated = true
      notifyEscalated(workspace.id, dispatch, 'recovery_failed', tickedAt)
      logger?.warn(
        `compact recovery failed workspace_id=${workspace.id} agent_id=${dispatch.toAgentId} dispatch_id=${dispatch.id}`,
        error
      )
    }
  }

  const inspectDispatch = async (
    workspace: WorkspaceSummary,
    dispatch: DispatchRecord,
    tickedAt: number
  ) => {
    if (!isActiveDispatchStatus(dispatch.status) || dispatch.submittedAt === null) return
    const activeRun = getActiveRunByAgentId(workspace.id, dispatch.toAgentId)
    if (!activeRun) return
    const snapshot = await getProgressSnapshot(workspace, dispatch, activeRun)
    let existing = watchStateByDispatchId.get(dispatch.id)
    if (!existing) {
      existing = {
        lastFingerprint: snapshot.fingerprint,
        lastProgressAt: dispatch.submittedAt,
      }
      watchStateByDispatchId.set(dispatch.id, existing)
    }
    if (snapshot.fingerprint !== existing.lastFingerprint) {
      existing.lastFingerprint = snapshot.fingerprint
      existing.lastProgressAt = tickedAt
      delete existing.softProbeAt
      existing.recoveryAttempted = false
      existing.escalated = false
      return
    }

    const idleForMs = tickedAt - existing.lastProgressAt
    if (idleForMs < hardWindowFor(dispatch) || existing.recoveryAttempted) return
    if (!autoRecoverEnabled) {
      if (!existing.escalated) {
        existing.escalated = true
        notifyEscalated(workspace.id, dispatch, 'no_progress', tickedAt)
      }
      return
    }
    if (existing.softProbeAt === undefined) {
      writeRunInput(activeRun.runId, buildSoftProbeInput(dispatch))
      existing.softProbeAt = tickedAt
      return
    }
    if (tickedAt - existing.softProbeAt < softProbeGraceMs) return
    await recoverDispatch(workspace, dispatch, activeRun, existing, tickedAt)
  }

  const tick = async () => {
    const tickedAt = now()
    const openDispatchIds = new Set<string>()
    for (const workspace of listWorkspaces()) {
      const dispatches = listOpenDispatchesForWorkspace(workspace.id)
      for (const dispatch of dispatches) {
        openDispatchIds.add(dispatch.id)
        try {
          await inspectDispatch(workspace, dispatch, tickedAt)
        } catch (error) {
          logger?.warn(
            `compact recovery inspect failed workspace_id=${workspace.id} dispatch_id=${dispatch.id}`,
            error
          )
        }
      }
    }
    for (const dispatchId of watchStateByDispatchId.keys()) {
      if (!openDispatchIds.has(dispatchId)) watchStateByDispatchId.delete(dispatchId)
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
