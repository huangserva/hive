import type { WorkspaceSummary } from '../shared/types.js'
import type { DispatchRecord } from './dispatch-ledger-store.js'
import type { HiveLogger } from './logger.js'

// 周期巡检 tick 间隔（与 sentinel-heartbeat 同节奏，每分钟扫一次）。
const DEFAULT_CHECK_INTERVAL_MS = 60 * 1000
// dispatch 卡在 submitted 多久算「活着但卡住」。默认 ~4 分钟：比正常一轮注入+开工长得多，
// 又比 sentinel-heartbeat 的 15/30 分钟 stale 阈值短，能更快兜住 Fix A 漏网的注入失败。
const DEFAULT_STALLED_SUBMITTED_MS = 4 * 60 * 1000

type ActiveRunRef = { runId: string } | undefined

export interface StalledDispatchNudgeOptions {
  getActiveRunByAgentId: (workspaceId: string, agentId: string) => ActiveRunRef
  injectNudge: (workspaceId: string, message: string) => void
  intervalMs?: number
  listOpenDispatchesForWorkspace: (workspaceId: string) => DispatchRecord[]
  listWorkspaces: () => WorkspaceSummary[]
  logger?: HiveLogger
  now?: () => number
  staleMs?: number
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

// Fix B 兜底：周期巡检「活着但卡住」的 dispatch。
// 命中条件：status='submitted' + submitted_at 超过 staleMs + 目标 worker 仍有 active run（alive）
//   + 未 report/cancel（listOpenDispatchesForWorkspace 只返回 queued/submitted）。
// 只 nudge orchestrator 由人核实/重投，绝不自动重投（避免双重执行）。
// worker 已 stopped（无 active run）的孤儿不在本机制处理 —— 交 reconcileOrphanedDispatches。
// 防重复：同一 dispatch 只 nudge 一次（跨 tick 用 Set 记忆）。
export const createStalledDispatchNudge = ({
  getActiveRunByAgentId,
  injectNudge,
  intervalMs = DEFAULT_CHECK_INTERVAL_MS,
  listOpenDispatchesForWorkspace,
  listWorkspaces,
  logger,
  now = Date.now,
  staleMs = DEFAULT_STALLED_SUBMITTED_MS,
}: StalledDispatchNudgeOptions) => {
  let timer: NodeJS.Timeout | null = null
  const nudgedDispatchIds = new Set<string>()

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

  const tick = () => {
    const tickedAt = now()
    for (const workspace of listWorkspaces()) {
      try {
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
