import type { DispatchRecord } from './dispatch-ledger-store.js'

// 派单多久未 report 算「超时未汇报」。与 stalled-dispatch-nudge 的 submitted 阈值同源（~4 分钟）：
// 比正常一轮注入+开工长，但要尽快让 user 看见 worker「干完不报 / 卡住」。
export const DEFAULT_STALE_DISPATCH_MS = 4 * 60 * 1000
// 升级阈值：超过这个时长仍未 report，视为「连续提醒无效 / 真卡住」，给 user 更醒目信号。
// ~2x stale：到这会儿 worker idle 自愈 nudge（最多 K 次）+ orchestrator 兜底 nudge 早该发生过。
export const DEFAULT_ESCALATED_DISPATCH_MS = 8 * 60 * 1000

export interface StaleDispatchEntry {
  dispatchId: string
  escalated: boolean
  minutesAgo: number
  submittedAt: number
  toAgentId: string
}

export interface StaleDispatchSummary {
  // escalatedCount 是 staleCount 的子集（escalated 一定也 stale）。
  escalatedCount: number
  stale: StaleDispatchEntry[]
  staleCount: number
}

export interface StaleDispatchThresholds {
  escalatedMs?: number
  staleMs?: number
}

// 纯函数：从 dispatch ledger + 当前时间推导「超时未汇报」清单，dashboard 与 nudge 共用同一判定。
// 只看 submitted（已注入 worker、未 report 的窗口；ledger 无独立 in_progress 态，submitted 即「在办未报」）。
// queued（未注入）属 Fix A / orphan reconcile 范畴，reported/cancelled 已终结，均不算。
export const summarizeStaleDispatches = (
  dispatches: DispatchRecord[],
  now: number,
  thresholds: StaleDispatchThresholds = {}
): StaleDispatchSummary => {
  const staleMs = thresholds.staleMs ?? DEFAULT_STALE_DISPATCH_MS
  const escalatedMs = thresholds.escalatedMs ?? DEFAULT_ESCALATED_DISPATCH_MS
  const stale: StaleDispatchEntry[] = []
  for (const dispatch of dispatches) {
    if (dispatch.status !== 'submitted') continue
    if (dispatch.submittedAt === null) continue
    const age = now - dispatch.submittedAt
    if (age < staleMs) continue
    stale.push({
      dispatchId: dispatch.id,
      escalated: age >= escalatedMs,
      minutesAgo: Math.floor(age / 60_000),
      submittedAt: dispatch.submittedAt,
      toAgentId: dispatch.toAgentId,
    })
  }
  return {
    escalatedCount: stale.filter((entry) => entry.escalated).length,
    stale,
    staleCount: stale.length,
  }
}
