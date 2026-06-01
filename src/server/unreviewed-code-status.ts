import type { WorkerRole } from '../shared/types.js'
import type { AIAction } from './cockpit-doc.js'
import type { DispatchRecord } from './dispatch-ledger-store.js'

// M34 Phase 1：未审代码改动看板兜底。
//
// 洞：代码审查靠 PM 手动记得派 reviewer（钟馗）。PM 自审 9 行 i18n 漏派被 user 戳穿。
// 兜底：claude coder report 了代码改动、但其后没有 reviewer dispatch 跟上 → 看板硬亮「未审」，
// never-silent，不靠 PM 记性。同构 M30 stale-dispatch（纯函数 summarize + 看板兜底 + push）。
//
// 设计判定（见 ADR `.hive/decisions/2026-06-01-unreviewed-code-backstop.md` + spike）：
// - 判「产生代码改动」= worker role 主门（Phase 1 限 claude coder）+ report-only 反向排除器。
//   弃 git 提交窗口归因：HippoTeam 是 PM 审后才在主树 commit（worker 不 commit）、M32 worktree
//   提交不在 main，git 无法可靠归因到单条 coder dispatch。role 是最贴治理模型的信号。
// - 判「已审」= 启发式时序配对：coder dispatch reported 后、同 workspace 其后出现任意 reviewer-role
//   dispatch 即消解（精确 link 留 Phase 2）。
// - 零 schema：纯从现有 dispatch ledger 字段 + getWorkerRole 反查推导（照 M30）。

// reported 后给 PM 派 reviewer 的宽限：避免刚 report 就亮（PM 还没来得及派钟馗）。
export const DEFAULT_UNREVIEWED_GRACE_MS = 2 * 60 * 1000

// report-only / spike 信号：调研/spike dispatch 派给 coder 产报告但 0 行代码——头号假阳，
// 必须排除（M34 spike 自己就是活例）。关键词命中即视为 report-only 倾向。
const REPORT_ONLY_TEXT =
  /调研|spike|不改产品代码|未改.*?(产品)?代码|纯设计|纯文档|report[-\s]?only|design\s+spike/iu
// 文档型 artifact（报告 / 笔记），非代码。
const DOC_ARTIFACT = /\.(html?|md|markdown)$/i

export interface WorkerRoleInfo {
  commandPresetId?: string | undefined
  role: WorkerRole | 'orchestrator'
}

export interface UnreviewedCodeEntry {
  dispatchId: string
  minutesAgo: number
  reportedAt: number
  toAgentId: string
}

export interface UnreviewedCodeSummary {
  unreviewed: UnreviewedCodeEntry[]
  unreviewedCount: number
}

export interface UnreviewedCodeThresholds {
  graceMs?: number
}

// report-only 反向排除器。压头号假阳（调研/spike dispatch 0 代码）。
// 规则：
//   - 若 artifacts 含**非文档**附件（如 `src/foo.ts`）→ 一定是代码改动，**绝不**排除（改动信号优先）。
//   - 否则：reportText 命中 report-only 关键词，**或** artifacts 全是文档型 → 判 report-only。
// 注意：真实 spike report 常**不带 artifacts**（如 M34 spike 用 `team report --stdin` 无 --artifact），
// 故不能要求「artifacts 仅文档」做硬前置——靠 reportText 关键词兜住无附件的 spike（这是与 spike 文档
// 字面"且"条件的有意偏离，目的正是让 M34 spike 自己被排除；详见 report，待钟馗审）。
export const isReportOnlyDispatch = (dispatch: DispatchRecord): boolean => {
  const artifacts = dispatch.artifacts
  const hasCodeArtifact = artifacts.some((artifact) => !DOC_ARTIFACT.test(artifact))
  if (hasCodeArtifact) return false
  const onlyDocArtifacts = artifacts.length > 0 && artifacts.every((a) => DOC_ARTIFACT.test(a))
  const textSaysReportOnly = REPORT_ONLY_TEXT.test(dispatch.reportText ?? '')
  return textSaysReportOnly || onlyDocArtifacts
}

const isClaudeCoder = (info: WorkerRoleInfo | undefined): boolean =>
  info?.role === 'coder' && info.commandPresetId === 'claude'

// 纯函数：从 dispatch ledger（单 workspace、任意状态）+ worker role 反查推导「未审代码改动」清单。
// dashboard / push 共用同一判定（照 M30 summarizeStaleDispatches）。
export const summarizeUnreviewedCodeDispatches = (
  dispatches: DispatchRecord[],
  getWorkerRole: (agentId: string) => WorkerRoleInfo | undefined,
  now: number,
  thresholds: UnreviewedCodeThresholds = {}
): UnreviewedCodeSummary => {
  const graceMs = thresholds.graceMs ?? DEFAULT_UNREVIEWED_GRACE_MS

  // 「已审」信号源：同 workspace 内所有非 cancelled 的 reviewer-role dispatch（按 report 后到达判定）。
  const reviewerDispatchCreatedAts = dispatches
    .filter(
      (dispatch) =>
        dispatch.status !== 'cancelled' && getWorkerRole(dispatch.toAgentId)?.role === 'reviewer'
    )
    .map((dispatch) => dispatch.createdAt)

  const unreviewed: UnreviewedCodeEntry[] = []
  for (const dispatch of dispatches) {
    if (dispatch.status !== 'reported') continue
    if (dispatch.reportedAt === null) continue
    // role 主门：Phase 1 限 claude coder。
    if (!isClaudeCoder(getWorkerRole(dispatch.toAgentId))) continue
    // report-only / spike → 无代码改动，不计（压头号假阳）。
    if (isReportOnlyDispatch(dispatch)) continue
    // 刚 report 的宽限期内不亮（给 PM 派 reviewer 的时间）。
    if (now - dispatch.reportedAt < graceMs) continue
    // 启发式时序配对：该 dispatch report 之后出现过任意 reviewer dispatch → 视为已审，消解。
    const reviewed = reviewerDispatchCreatedAts.some(
      (createdAt) => createdAt >= (dispatch.reportedAt as number)
    )
    if (reviewed) continue
    unreviewed.push({
      dispatchId: dispatch.id,
      minutesAgo: Math.floor((now - dispatch.reportedAt) / 60_000),
      reportedAt: dispatch.reportedAt,
      toAgentId: dispatch.toAgentId,
    })
  }

  return { unreviewed, unreviewedCount: unreviewed.length }
}

// 把「未审」summary 转成 Cockpit AIAction（severity=high，targetTab=tasks）。
export const buildUnreviewedCodeActions = (
  summary: UnreviewedCodeSummary,
  getWorkerName?: (agentId: string) => string | undefined
): AIAction[] =>
  summary.unreviewed.map((entry) => ({
    action: '派 reviewer',
    id: `unreviewed-code:${entry.dispatchId}`,
    priority: 'high',
    targetTab: 'tasks',
    text: `${getWorkerName?.(entry.toAgentId) ?? entry.toAgentId} 的代码改动（dispatch ${entry.dispatchId.slice(0, 8)}…，约 ${entry.minutesAgo} 分钟前 report）尚未派 reviewer 审查，请派 reviewer（如钟馗）或显式判定免审`,
    type: 'unreviewed_code',
  }))

// 在「serve cockpit 的边界」把 DB 派生的「未审」action 合并进 file-only 的 aiActions。
// **关键契约**：本函数在边界调用，绝不进 parseCockpit / buildAiActions（它们 file-only、不碰 DB）。
export const augmentAiActionsWithUnreviewedCode = (
  baseActions: AIAction[],
  input: {
    dispatches: DispatchRecord[]
    now: number
    thresholds?: UnreviewedCodeThresholds
    workers: Array<{ commandPresetId?: string; id: string; name: string; role: WorkerRole }>
  }
): AIAction[] => {
  const roleByAgent = new Map<string, WorkerRoleInfo>(
    input.workers.map((worker) => [
      worker.id,
      { commandPresetId: worker.commandPresetId, role: worker.role },
    ])
  )
  const nameByAgent = new Map(input.workers.map((worker) => [worker.id, worker.name]))
  const summary = summarizeUnreviewedCodeDispatches(
    input.dispatches,
    (agentId) => roleByAgent.get(agentId),
    input.now,
    input.thresholds
  )
  if (summary.unreviewedCount === 0) return baseActions
  return [...baseActions, ...buildUnreviewedCodeActions(summary, (id) => nameByAgent.get(id))]
}
