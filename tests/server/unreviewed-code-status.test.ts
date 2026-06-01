import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { parseCockpit } from '../../src/server/cockpit-doc.js'
import type { DispatchRecord } from '../../src/server/dispatch-ledger-store.js'
import {
  augmentAiActionsWithUnreviewedCode,
  DEFAULT_UNREVIEWED_GRACE_MS,
  isReportOnlyDispatch,
  summarizeUnreviewedCodeDispatches,
  type WorkerRoleInfo,
} from '../../src/server/unreviewed-code-status.js'

// M34 Phase 1：纯函数 + 边界合并的单测。无 PTY、无 DB——直接 craft dispatch ledger 记录 + role 取数器（§13）。

const NOW = 1_700_000_000_000
const TEN_MIN_AGO = NOW - 10 * 60_000

let seq = 0
const makeDispatch = (over: Partial<DispatchRecord> = {}): DispatchRecord => ({
  artifacts: [],
  createdAt: NOW - 20 * 60_000,
  deliveredAt: null,
  fromAgentId: 'ws:orchestrator',
  id: `d-${++seq}`,
  reportedAt: null,
  reportText: null,
  sequence: seq,
  status: 'reported',
  submittedAt: NOW - 19 * 60_000,
  text: '改一下登录逻辑',
  toAgentId: 'agent-guan',
  workspaceId: 'ws',
  ...over,
})

// role 取数器：关羽=claude coder，黄忠=codex coder，钟馗=reviewer。
const ROLES: Record<string, WorkerRoleInfo> = {
  'agent-guan': { commandPresetId: 'claude', role: 'coder' },
  'agent-huang': { commandPresetId: 'codex', role: 'coder' },
  'agent-zhong': { commandPresetId: 'codex', role: 'reviewer' },
}
const getWorkerRole = (agentId: string): WorkerRoleInfo | undefined => ROLES[agentId]

describe('summarizeUnreviewedCodeDispatches', () => {
  // ① claude coder 改代码后无 reviewer dispatch → 标未审
  test('claude coder reported with no following reviewer dispatch → flagged unreviewed', () => {
    const dispatches = [
      makeDispatch({ reportedAt: TEN_MIN_AGO, reportText: '改了 auth.ts，新增 3 个测试' }),
    ]
    const summary = summarizeUnreviewedCodeDispatches(dispatches, getWorkerRole, NOW)
    expect(summary.unreviewedCount).toBe(1)
    expect(summary.unreviewed[0]?.toAgentId).toBe('agent-guan')
    expect(summary.unreviewed[0]?.minutesAgo).toBe(10)
  })

  // ② 其后出现 reviewer dispatch → 消解
  test('a reviewer dispatch created after the coder report clears it', () => {
    const coder = makeDispatch({ reportedAt: TEN_MIN_AGO, reportText: '改了 auth.ts' })
    const reviewer = makeDispatch({
      createdAt: TEN_MIN_AGO + 1000, // 在 coder report 之后派出
      id: 'd-review',
      status: 'submitted',
      toAgentId: 'agent-zhong',
    })
    const summary = summarizeUnreviewedCodeDispatches([coder, reviewer], getWorkerRole, NOW)
    expect(summary.unreviewedCount).toBe(0)
  })

  test('a reviewer dispatch created BEFORE the coder report does NOT clear it', () => {
    const coder = makeDispatch({ reportedAt: TEN_MIN_AGO, reportText: '改了 auth.ts' })
    const earlierReviewer = makeDispatch({
      createdAt: TEN_MIN_AGO - 60_000, // 在 coder report 之前——审的是别的东西，不算
      id: 'd-review-old',
      status: 'reported',
      toAgentId: 'agent-zhong',
    })
    const summary = summarizeUnreviewedCodeDispatches([coder, earlierReviewer], getWorkerRole, NOW)
    expect(summary.unreviewedCount).toBe(1)
  })

  // ③ 调研/spike dispatch（report-only）→ 不标未审
  test('report-only spike with doc artifacts + spike text → NOT flagged', () => {
    const spike = makeDispatch({
      artifacts: ['.hive/reports/x.html', '.hive/research/x.md'],
      reportText: '【完成】M34 设计 spike，不改产品代码，产出 reports+research',
      reportedAt: TEN_MIN_AGO,
    })
    expect(isReportOnlyDispatch(spike)).toBe(true)
    expect(summarizeUnreviewedCodeDispatches([spike], getWorkerRole, NOW).unreviewedCount).toBe(0)
  })

  // ③b 关键：真实 spike report 常**不带 artifacts**（M34 spike 自己即例）——靠 reportText 关键词兜住
  test('report-only spike with NO artifacts but spike text → still NOT flagged (the M34-spike case)', () => {
    const spikeNoArtifacts = makeDispatch({
      artifacts: [],
      reportText: '【完成】M34 设计 spike：纯设计 + 深读现有代码，未改任何产品代码。',
      reportedAt: TEN_MIN_AGO,
    })
    expect(isReportOnlyDispatch(spikeNoArtifacts)).toBe(true)
    expect(
      summarizeUnreviewedCodeDispatches([spikeNoArtifacts], getWorkerRole, NOW).unreviewedCount
    ).toBe(0)
  })

  test('code-artifact overrides spike text: a code change is never excluded', () => {
    const mixed = makeDispatch({
      artifacts: ['src/server/foo.ts'], // 含代码附件 → 改动信号优先
      reportText: '顺手提了个 spike 想法，但本次改了 foo.ts',
      reportedAt: TEN_MIN_AGO,
    })
    expect(isReportOnlyDispatch(mixed)).toBe(false)
    expect(summarizeUnreviewedCodeDispatches([mixed], getWorkerRole, NOW).unreviewedCount).toBe(1)
  })

  // 钟馗 风险1：无 artifacts + reportText 同时含 spike/调研 和真实代码改动动词 → **必须标未审**
  // （正向代码信号压过 report-only 措辞，避免"调研后改了 src/foo.ts"被静默漏报）。
  test('no artifacts + reportText has BOTH spike/调研 AND a real code change → flagged (risk1)', () => {
    const sneaky = makeDispatch({
      artifacts: [],
      reportText: '先做了调研，spike 了一下方案，然后改了 src/server/foo.ts 并加了测试',
      reportedAt: TEN_MIN_AGO,
    })
    expect(isReportOnlyDispatch(sneaky)).toBe(false)
    expect(summarizeUnreviewedCodeDispatches([sneaky], getWorkerRole, NOW).unreviewedCount).toBe(1)
  })

  test('bare 调研/spike mention without strong report-only phrase does NOT exclude (no裸关键词排除)', () => {
    // 仅提一句"调研"但无"不改代码/纯设计"等强短语、也无代码动词 → 不当 report-only（宁可多亮）。
    const bareMention = makeDispatch({
      artifacts: [],
      reportText: '关于这个 spike 的想法记录在这里',
      reportedAt: TEN_MIN_AGO,
    })
    expect(isReportOnlyDispatch(bareMention)).toBe(false)
  })

  // ④ 非 claude coder Phase 1 不标
  test('non-claude coder (codex) is NOT flagged in Phase 1', () => {
    const codexCoder = makeDispatch({
      reportText: '改了 auth.ts',
      reportedAt: TEN_MIN_AGO,
      toAgentId: 'agent-huang',
    })
    expect(
      summarizeUnreviewedCodeDispatches([codexCoder], getWorkerRole, NOW).unreviewedCount
    ).toBe(0)
  })

  test('reviewer-role dispatch itself is never flagged as unreviewed code', () => {
    const reviewerReport = makeDispatch({
      reportText: '审完，3 处问题',
      reportedAt: TEN_MIN_AGO,
      toAgentId: 'agent-zhong',
    })
    expect(
      summarizeUnreviewedCodeDispatches([reviewerReport], getWorkerRole, NOW).unreviewedCount
    ).toBe(0)
  })

  test('within grace window after report → not yet flagged', () => {
    const justReported = makeDispatch({
      reportText: '改了 auth.ts',
      reportedAt: NOW - (DEFAULT_UNREVIEWED_GRACE_MS - 5_000), // 还在宽限内
    })
    expect(
      summarizeUnreviewedCodeDispatches([justReported], getWorkerRole, NOW).unreviewedCount
    ).toBe(0)
  })

  test('non-reported (submitted/queued/cancelled) coder dispatches are not flagged', () => {
    const submitted = makeDispatch({ reportedAt: null, status: 'submitted' })
    const cancelled = makeDispatch({
      id: 'd-c',
      reportText: '改了码',
      reportedAt: TEN_MIN_AGO,
      status: 'cancelled',
    })
    expect(
      summarizeUnreviewedCodeDispatches([submitted, cancelled], getWorkerRole, NOW).unreviewedCount
    ).toBe(0)
  })
})

describe('augmentAiActionsWithUnreviewedCode (serve-cockpit boundary)', () => {
  const workers = [
    { commandPresetId: 'claude', id: 'agent-guan', name: '关羽', role: 'coder' as const },
    { commandPresetId: 'codex', id: 'agent-zhong', name: '钟馗', role: 'reviewer' as const },
  ]

  test('appends a high-severity unreviewed_code action without mutating the base (file-derived) actions', () => {
    const base = [
      {
        action: '回答',
        id: 'q1',
        priority: 'medium' as const,
        targetTab: 'questions' as const,
        text: 'Q',
        type: 'question' as const,
      },
    ]
    const merged = augmentAiActionsWithUnreviewedCode(base, {
      dispatches: [makeDispatch({ reportText: '改了 auth.ts', reportedAt: TEN_MIN_AGO })],
      now: NOW,
      workers,
    })
    expect(base).toHaveLength(1) // 原数组（来自 parseCockpit 的 file-only 产物）未被改动
    expect(merged).toHaveLength(2)
    const added = merged.find((action) => action.type === 'unreviewed_code')
    expect(added?.priority).toBe('high')
    expect(added?.targetTab).toBe('tasks')
    expect(added?.text).toContain('关羽')
  })

  test('no unreviewed → returns base actions unchanged', () => {
    const base = [
      {
        action: '回答',
        id: 'q1',
        priority: 'low' as const,
        targetTab: 'questions' as const,
        text: 'Q',
        type: 'question' as const,
      },
    ]
    const merged = augmentAiActionsWithUnreviewedCode(base, {
      // 强 report-only 短语（不改产品代码）→ 被排除 → 无未审 → base 原样返回。
      dispatches: [
        makeDispatch({ reportText: 'M34 设计 spike，不改产品代码', reportedAt: TEN_MIN_AGO }),
      ],
      now: NOW,
      workers,
    })
    expect(merged).toBe(base)
  })
})

// ⑤ 合并点不污染 parseCockpit 的 file-only 契约：parseCockpit（纯读 .hive 文件）永远产不出
// unreviewed_code（它不碰 DB）；该类型只能由边界 augment 注入。
describe('parseCockpit file-only contract is preserved', () => {
  const tmpDirs: string[] = []
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  })

  test('parseCockpit never emits unreviewed_code; only the boundary augment can', () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-cockpit-'))
    tmpDirs.push(workspacePath)
    const cockpit = parseCockpit(workspacePath)
    // file 源永远不含 unreviewed_code（即使 DB 里有未审 dispatch，parseCockpit 也看不到 DB）。
    expect(cockpit.aiActions.some((action) => action.type === 'unreviewed_code')).toBe(false)
    // 只有边界 augment 能注入。
    const merged = augmentAiActionsWithUnreviewedCode(cockpit.aiActions, {
      dispatches: [makeDispatch({ reportText: '改了 auth.ts', reportedAt: TEN_MIN_AGO })],
      now: NOW,
      workers: [{ commandPresetId: 'claude', id: 'agent-guan', name: '关羽', role: 'coder' }],
    })
    expect(merged.some((action) => action.type === 'unreviewed_code')).toBe(true)
  })
})
