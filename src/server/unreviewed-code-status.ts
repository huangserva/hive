import type { WorkerRole } from '../shared/types.js'
import type { AIAction } from './cockpit-doc.js'
import { type DispatchRecord, isCompletedDispatchStatus } from './dispatch-ledger-store.js'

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

// 正向「代码改动」信号：改动**动词**（不是单纯提到文件路径——调研报告也会引用 `src/x.ts:42`）。
// 命中即视为真有代码改动，**绝不**当 report-only（钟馗 风险1：避免"调研后改了 src/foo.ts"被误排漏报）。
const CODE_CHANGE_SIGNAL =
  /改了|修改了|改动了|新增了?|删除了?|重构了?|实现了|修复了|修了|加了|提交了|打了补丁|\b(fixed|implemented|refactored|added|changed)\b/iu
// 强 report-only 短语：不用裸 `调研|spike`（真改了码也可能提"调研后改了…"），要明确的"未产代码"措辞。
const REPORT_ONLY_TEXT =
  /不改产品代码|不改代码|没改[^\n。]{0,6}代码|未改[^\n。]{0,8}代码|纯(设计|文档|调研|方案)|只(出|产|做)[^\n。]{0,6}(设计|文档|报告|方案|spike)|report[-\s]?only|design\s+spike/iu
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
  // M43: 当 dispatch 已被 accept/reject/waive 后，aiAction 可附带 verdict reason 让 PM 看到处理记录。
  verdictReason?: string
  verdictStatus?: 'pending' | 'accepted' | 'rejected' | 'waived' | null
}

export interface UnreviewedCodeSummary {
  unreviewed: UnreviewedCodeEntry[]
  unreviewedCount: number
}

export interface UnreviewedCodeThresholds {
  graceMs?: number
}

// report-only 反向排除器。压头号假阳（调研/spike dispatch 0 代码）。
// 优先级（钟馗 风险1 返工——正向代码信号必须压过 report-only 措辞，否则"调研后改了 src/foo.ts"会被误排漏报）：
//   1. artifacts 含**非文档**附件（如 `src/foo.ts`）→ 一定是代码改动，**绝不**排除。
//   2. reportText 含**代码改动动词**（改了/新增/重构…）→ 真改了码，**绝不**排除（即便也提了 spike/调研）。
//   3. 否则：reportText 命中**强** report-only 短语，**或** artifacts 全是文档型 → 判 report-only。
// 注意：真实 spike report 常**不带 artifacts**（M34 spike 用 `team report --stdin` 无 --artifact），
// 故靠强 report-only 短语（"不改产品代码/纯设计…"）兜住无附件的 spike，而非裸 `调研|spike`。
export const isReportOnlyDispatch = (dispatch: DispatchRecord): boolean => {
  const artifacts = dispatch.artifacts
  const text = dispatch.reportText ?? ''
  const hasCodeArtifact = artifacts.some((artifact) => !DOC_ARTIFACT.test(artifact))
  if (hasCodeArtifact) return false
  if (CODE_CHANGE_SIGNAL.test(text)) return false
  const onlyDocArtifacts = artifacts.length > 0 && artifacts.every((a) => DOC_ARTIFACT.test(a))
  return REPORT_ONLY_TEXT.test(text) || onlyDocArtifacts
}

const isClaudeCoder = (info: WorkerRoleInfo | undefined): boolean =>
  info?.role === 'coder' && info.commandPresetId === 'claude'

// 纯函数：从 dispatch ledger（单 workspace、任意状态）+ worker role 反查推导「未审代码改动」清单。
// dashboard / push 共用同一判定（照 M30 summarizeStaleDispatches）。
//
// M43 升级：在启发式时序配对之上**优先**用精确 reviews_dispatch_id 配对。
// - 精确链接（reviewer dispatch.reviewsDispatchId === coder.id）+ verdict accepted/waived → 消解
// - verdict rejected → 仍亮（要求重报），并附带 verdict reason
// - dispatch 自己 reviewStatus = accepted/waived → 也消解（PM 旁路 team accept）
// - 无精确链接也无 reviewStatus 时，回退到启发式时序配对（保持兼容期 fallback）
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

  // M43: 精确链接的反向索引：被审 coder dispatch.id → 配对的 reviewer dispatch 列表。
  const reviewerLinks = new Map<string, DispatchRecord[]>()
  for (const dispatch of dispatches) {
    if (dispatch.status === 'cancelled') continue
    if (getWorkerRole(dispatch.toAgentId)?.role !== 'reviewer') continue
    if (!dispatch.reviewsDispatchId) continue
    const list = reviewerLinks.get(dispatch.reviewsDispatchId) ?? []
    list.push(dispatch)
    reviewerLinks.set(dispatch.reviewsDispatchId, list)
  }

  const unreviewed: UnreviewedCodeEntry[] = []
  for (const dispatch of dispatches) {
    if (!isCompletedDispatchStatus(dispatch.status)) continue
    if (dispatch.reportedAt === null) continue
    // role 主门：Phase 1 限 claude coder。
    if (!isClaudeCoder(getWorkerRole(dispatch.toAgentId))) continue
    // report-only / spike → 无代码改动，不计（压头号假阳）。
    if (isReportOnlyDispatch(dispatch)) continue
    // 刚 report 的宽限期内不亮（给 PM 派 reviewer 的时间）。
    if (now - dispatch.reportedAt < graceMs) continue

    // M43 优先：dispatch 自己 reviewStatus 上的 verdict——accepted/waived → 消解；
    // rejected → 仍亮（要求重报），并把 verdict reason 透出给 PM 看。
    // pending / null → 走精确链接 或 启发式 fallback。
    if (dispatch.reviewStatus === 'accepted' || dispatch.reviewStatus === 'waived') continue

    const links = reviewerLinks.get(dispatch.id) ?? []
    const hasPreciseLink = links.length > 0
    if (dispatch.reviewStatus !== 'rejected') {
      // 精确链接存在 + 任一 reviewer 已 reported → 消解（accepted/waived 已在上面拦下；
      // 仅可能是 reviewer 报了但 worker 没传 verdict 的旧 dispatch，此时视为兼容期"已审"）。
      if (hasPreciseLink) {
        const reviewedByLinked = links.some((link) => isCompletedDispatchStatus(link.status))
        if (reviewedByLinked) continue
      } else {
        // 启发式时序配对（精确链接缺失时兼容期兜底）。
        const reviewed = reviewerDispatchCreatedAts.some(
          (createdAt) => createdAt >= (dispatch.reportedAt as number)
        )
        if (reviewed) continue
      }
    }

    const entry: UnreviewedCodeEntry = {
      dispatchId: dispatch.id,
      minutesAgo: Math.floor((now - dispatch.reportedAt) / 60_000),
      reportedAt: dispatch.reportedAt,
      toAgentId: dispatch.toAgentId,
    }
    // verdict reason 透出：本 dispatch 上的 accept_verdict 是 reviewer 写的（含 rejected reason）。
    if (dispatch.acceptVerdict?.reason) {
      entry.verdictReason = dispatch.acceptVerdict.reason
    }
    if (dispatch.reviewStatus) {
      entry.verdictStatus = dispatch.reviewStatus
    }
    unreviewed.push(entry)
  }

  return { unreviewed, unreviewedCount: unreviewed.length }
}

// 把「未审」summary 转成 Cockpit AIAction（severity=high，targetTab=tasks）。
// M43 升级：附带 verdict reason / status，让 PM 看到 reviewer 留下的 rejected 原因
// 或自己 accept 时的 reason，不用回去翻 dispatch 详情。
export const buildUnreviewedCodeActions = (
  summary: UnreviewedCodeSummary,
  getWorkerName?: (agentId: string) => string | undefined
): AIAction[] =>
  summary.unreviewed.map((entry) => {
    const baseText = `${getWorkerName?.(entry.toAgentId) ?? entry.toAgentId} 的代码改动（dispatch ${entry.dispatchId.slice(0, 8)}…，约 ${entry.minutesAgo} 分钟前 report）尚未派 reviewer 审查，请派 reviewer（如钟馗）或显式判定免审`
    const verdictSuffix = (() => {
      if (entry.verdictStatus === 'rejected' && entry.verdictReason) {
        return ` · reviewer 判 rejected：${entry.verdictReason}（worker 需重报）`
      }
      if (entry.verdictStatus === 'pending') {
        return ' · review pending'
      }
      return ''
    })()
    return {
      action: '派 reviewer',
      id: `unreviewed-code:${entry.dispatchId}`,
      priority: 'high',
      targetTab: 'tasks',
      text: `${baseText}${verdictSuffix}`,
      type: 'unreviewed_code',
    }
  })

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
