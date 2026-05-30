import type { WorkspaceSummary } from '../shared/types.js'
import type { DispatchRecord } from './dispatch-ledger-store.js'
import type { HiveLogger } from './logger.js'
import { hasInteractivePromptReady } from './post-start-input-writer.js'

// 周期巡检 tick 间隔（与 sentinel-heartbeat 同节奏，每分钟扫一次）。
const DEFAULT_CHECK_INTERVAL_MS = 60 * 1000
// dispatch 卡在 submitted 多久算「活着但卡住」。默认 ~4 分钟：比正常一轮注入+开工长得多，
// 又比 sentinel-heartbeat 的 15/30 分钟 stale 阈值短，能更快兜住 Fix A 漏网的注入失败。
const DEFAULT_STALLED_SUBMITTED_MS = 4 * 60 * 1000
const DEFAULT_IDLE_GRACE_MS = 20 * 1000
const DEFAULT_MAX_WORKER_NUDGES = 2

type ActiveRunRef = { output?: string; runId: string } | undefined

export interface StalledDispatchNudgeOptions {
  getActiveRunByAgentId: (workspaceId: string, agentId: string) => ActiveRunRef
  getWorkerOutputSinceActivity?: (workspaceId: string, agentId: string) => string
  injectNudge: (workspaceId: string, message: string) => void
  injectWorkerNudge?: (workspaceId: string, agentId: string, message: string) => void
  idleGraceMs?: number
  intervalMs?: number
  listOpenDispatchesForWorkspace: (workspaceId: string) => DispatchRecord[]
  listWorkspaces: () => WorkspaceSummary[]
  logger?: HiveLogger
  maxWorkerNudgesPerDispatch?: number
  now?: () => number
  staleMs?: number
  writeRunInput?: (runId: string, input: string) => void
}

const formatSubmittedAt = (value: number | null) =>
  value === null ? 'unknown' : new Date(value).toISOString()

export const buildStalledDispatchNudgeMessage = (
  dispatches: Array<{ dispatchId: string; minutesAgo: number; submittedAt: number | null }>
) =>
  [
    '[Hive 系统消息：有 dispatch 卡在 submitted（worker 仍在线但长时间未 report）]',
    '以下 dispatch 已派发并注入、worker 仍 alive，但迟迟没有进展，疑似注入落空或 worker 卡住：',
    ...dispatches.map(
      (dispatch) =>
        `- dispatch_id=${dispatch.dispatchId}, submitted_at=${formatSubmittedAt(dispatch.submittedAt)}（约 ${dispatch.minutesAgo} 分钟前）`
    ),
    '请核实 worker 是否真的在处理（查看其终端 / git log）；如已落空，cancel 后重投，不要假设它在跑。',
    '（本提醒不会自动重投，避免双重执行。）',
  ].join('\n')

export const buildIdleWorkerReportReminderMessage = (dispatch: DispatchRecord) =>
  [
    '[Hive 系统消息]',
    `你的 dispatch ${dispatch.id} 看起来已完成但还没运行 team report。`,
    '请立即运行 team report 汇报（写文字总结不算汇报）；未完成也要 report 部分完成或阻塞。',
    `推荐命令：team report "<result>" --dispatch ${dispatch.id}`,
    `任务：${dispatch.text}`,
  ].join('\n')

// Fix B/L1 自愈：优先在 worker PTY 回到交互提示符后，直接提醒该 worker 真正运行 team report。
// 如果运行时没有提供 worker stdin 写入能力，则保留旧的「submitted 超时后 nudge orchestrator」兜底。
// worker 已 stopped（无 active run）的孤儿不在本机制处理 —— 交 reconcileOrphanedDispatches。
// 防重复：同一 dispatch 最多直提醒 maxWorkerNudgesPerDispatch 次，再回退 orchestrator nudge 一次。
export const createStalledDispatchNudge = ({
  getActiveRunByAgentId,
  getWorkerOutputSinceActivity,
  injectNudge,
  injectWorkerNudge,
  idleGraceMs = DEFAULT_IDLE_GRACE_MS,
  intervalMs = DEFAULT_CHECK_INTERVAL_MS,
  listOpenDispatchesForWorkspace,
  listWorkspaces,
  logger,
  maxWorkerNudgesPerDispatch = DEFAULT_MAX_WORKER_NUDGES,
  now = Date.now,
  staleMs = DEFAULT_STALLED_SUBMITTED_MS,
  writeRunInput,
}: StalledDispatchNudgeOptions) => {
  let timer: NodeJS.Timeout | null = null
  const nudgedDispatchIds = new Set<string>()
  const idleReadySinceByDispatchId = new Map<string, number>()
  const outputBaselineByDispatchId = new Map<string, number>()
  const workerNudgeCountsByDispatchId = new Map<string, number>()

  const hasIdleSelfHeal = Boolean(injectWorkerNudge || writeRunInput)

  const cleanupClosedDispatchState = (openDispatches: DispatchRecord[]) => {
    const openIds = new Set(openDispatches.map((dispatch) => dispatch.id))
    for (const dispatchId of idleReadySinceByDispatchId.keys()) {
      if (!openIds.has(dispatchId)) idleReadySinceByDispatchId.delete(dispatchId)
    }
    for (const dispatchId of outputBaselineByDispatchId.keys()) {
      if (!openIds.has(dispatchId)) outputBaselineByDispatchId.delete(dispatchId)
    }
    for (const dispatchId of workerNudgeCountsByDispatchId.keys()) {
      if (!openIds.has(dispatchId)) workerNudgeCountsByDispatchId.delete(dispatchId)
    }
  }

  const findAliveSubmittedDispatches = (workspaceId: string) => {
    const openDispatches = listOpenDispatchesForWorkspace(workspaceId)
    cleanupClosedDispatchState(openDispatches)
    return openDispatches.flatMap((dispatch) => {
      if (dispatch.status !== 'submitted') return []
      const activeRun = getActiveRunByAgentId(workspaceId, dispatch.toAgentId)
      if (!activeRun) return []
      return [{ activeRun, dispatch }]
    })
  }

  const findStalledDispatches = (workspaceId: string, tickedAt: number) =>
    listOpenDispatchesForWorkspace(workspaceId).filter((dispatch) => {
      if (dispatch.status !== 'submitted') return false
      if (dispatch.submittedAt === null) return false
      if (tickedAt - dispatch.submittedAt < staleMs) return false
      // worker 必须仍 alive（有 active run）；已 stopped 的交 reconcile，不在此 nudge。
      if (!getActiveRunByAgentId(workspaceId, dispatch.toAgentId)) return false
      if (nudgedDispatchIds.has(dispatch.id)) return false
      return true
    })

  const getOutputSinceActivity = (
    workspaceId: string,
    dispatch: DispatchRecord,
    activeRun: NonNullable<ActiveRunRef>
  ) => {
    if (getWorkerOutputSinceActivity) {
      return getWorkerOutputSinceActivity(workspaceId, dispatch.toAgentId)
    }
    if (typeof activeRun.output !== 'string') return ''
    const previousBaseline = outputBaselineByDispatchId.get(dispatch.id)
    if (previousBaseline === undefined || previousBaseline > activeRun.output.length) {
      outputBaselineByDispatchId.set(dispatch.id, activeRun.output.length)
      return ''
    }
    return activeRun.output.slice(previousBaseline)
  }

  const injectWorkerReminder = (
    workspaceId: string,
    dispatch: DispatchRecord,
    activeRun: NonNullable<ActiveRunRef>,
    message: string
  ) => {
    if (injectWorkerNudge) {
      injectWorkerNudge(workspaceId, dispatch.toAgentId, message)
      return
    }
    writeRunInput?.(activeRun.runId, message)
  }

  const handleIdleSelfHeal = (workspaceId: string, tickedAt: number) => {
    const dispatches = findAliveSubmittedDispatches(workspaceId)
    const fallbackDispatches: DispatchRecord[] = []
    for (const { activeRun, dispatch } of dispatches) {
      const outputSinceActivity = getOutputSinceActivity(workspaceId, dispatch, activeRun)
      if (!hasInteractivePromptReady(outputSinceActivity)) {
        idleReadySinceByDispatchId.delete(dispatch.id)
        continue
      }

      const readySince = idleReadySinceByDispatchId.get(dispatch.id)
      if (readySince === undefined) {
        idleReadySinceByDispatchId.set(dispatch.id, tickedAt)
        continue
      }
      if (tickedAt - readySince < idleGraceMs) continue

      const nudgeCount = workerNudgeCountsByDispatchId.get(dispatch.id) ?? 0
      if (nudgeCount < maxWorkerNudgesPerDispatch) {
        injectWorkerReminder(
          workspaceId,
          dispatch,
          activeRun,
          buildIdleWorkerReportReminderMessage(dispatch)
        )
        workerNudgeCountsByDispatchId.set(dispatch.id, nudgeCount + 1)
        idleReadySinceByDispatchId.set(dispatch.id, tickedAt)
        continue
      }

      if (!nudgedDispatchIds.has(dispatch.id)) fallbackDispatches.push(dispatch)
    }

    if (fallbackDispatches.length === 0) return
    injectNudge(
      workspaceId,
      buildStalledDispatchNudgeMessage(
        fallbackDispatches.map((dispatch) => ({
          dispatchId: dispatch.id,
          minutesAgo:
            dispatch.submittedAt === null
              ? 0
              : Math.floor((tickedAt - dispatch.submittedAt) / 60_000),
          submittedAt: dispatch.submittedAt,
        }))
      )
    )
    for (const dispatch of fallbackDispatches) nudgedDispatchIds.add(dispatch.id)
  }

  const tick = () => {
    const tickedAt = now()
    for (const workspace of listWorkspaces()) {
      try {
        if (hasIdleSelfHeal) {
          handleIdleSelfHeal(workspace.id, tickedAt)
          continue
        }
        const stalled = findStalledDispatches(workspace.id, tickedAt)
        if (stalled.length === 0) continue
        injectNudge(
          workspace.id,
          buildStalledDispatchNudgeMessage(
            stalled.map((dispatch) => ({
              dispatchId: dispatch.id,
              minutesAgo: Math.floor((tickedAt - (dispatch.submittedAt ?? tickedAt)) / 60_000),
              submittedAt: dispatch.submittedAt,
            }))
          )
        )
        for (const dispatch of stalled) nudgedDispatchIds.add(dispatch.id)
      } catch (error) {
        logger?.warn(`stalled dispatch nudge failed workspace_id=${workspace.id}`, error)
      }
    }
  }

  const start = () => {
    if (timer) return
    timer = setInterval(() => {
      tick()
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
