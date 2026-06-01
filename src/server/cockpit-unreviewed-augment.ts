import type { AIAction } from './cockpit-doc.js'
import type { RuntimeStore } from './runtime-store.js'
import { resolveCommandPresetId } from './team-list-enrichment.js'
import {
  buildUnreviewedCodeActions,
  summarizeUnreviewedCodeDispatches,
  type UnreviewedCodeSummary,
  type UnreviewedCodeThresholds,
  type WorkerRoleInfo,
} from './unreviewed-code-status.js'

// M34 BLOCKER 返工：**唯一**的 serve-cockpit 边界合并入口。所有生产注入点（web WS / mobile dashboard /
// mobile cockpit / relay / push 兜底）都走这里，避免某个点忘了解析 commandPresetId 又让功能形同虚设
// （上一版正是各点直接传 raw listWorkers——它**不含** commandPresetId，isClaudeCoder 恒 false）。
//
// 关键：commandPresetId 不在 `workspace-store.listWorkers()` 上（只有 id/name/role/status/…），
// 真实来源是 launch config（`peekAgentLaunchConfig`）→ 用 `resolveCommandPresetId` 解析，与 worker
// 卡片品牌 logo / enrichTeamList 同一套口径。

// 解析所需的最小 store 面：列 worker + 列 dispatch + 解析 launch preset。
export type UnreviewedCockpitStore = Pick<
  RuntimeStore,
  'listWorkers' | 'listDispatches' | 'peekAgentLaunchConfig' | 'settings'
>

export interface CockpitUnreviewedResult {
  // 在 file-only 的 aiActions 上**追加** DB 派生「未审」action（不 mutate base）。
  apply: (baseActions: AIAction[]) => AIAction[]
  count: number
  summary: UnreviewedCodeSummary
  workerNameOf: (agentId: string) => string | undefined
}

// 从真实 store 解析「未审代码改动」：raw listWorkers + resolveCommandPresetId 拼出带 preset 的 role map，
// 再喂纯函数 summarize。这是 BLOCKER 的根治点——preset 在此被真正解析出来。
export const resolveCockpitUnreviewedCode = (
  store: UnreviewedCockpitStore,
  workspaceId: string,
  now: number = Date.now(),
  thresholds?: UnreviewedCodeThresholds
): CockpitUnreviewedResult => {
  const workers = store.listWorkers(workspaceId)
  const roleByAgent = new Map<string, WorkerRoleInfo>(
    workers.map((worker) => [
      worker.id,
      {
        commandPresetId: resolveCommandPresetId(store, workspaceId, worker.id) ?? undefined,
        role: worker.role,
      },
    ])
  )
  const nameByAgent = new Map(workers.map((worker) => [worker.id, worker.name]))
  const summary = summarizeUnreviewedCodeDispatches(
    store.listDispatches(workspaceId),
    (agentId) => roleByAgent.get(agentId),
    now,
    thresholds
  )
  const workerNameOf = (agentId: string) => nameByAgent.get(agentId)
  return {
    apply: (baseActions) =>
      summary.unreviewedCount === 0
        ? baseActions
        : [...baseActions, ...buildUnreviewedCodeActions(summary, workerNameOf)],
    count: summary.unreviewedCount,
    summary,
    workerNameOf,
  }
}
