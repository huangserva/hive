import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { applyRuntimeEnvDefaults } from '../../src/cli/hive.js'
import { createAgentManager } from '../../src/server/agent-manager.js'
import { resolveCockpitUnreviewedCode } from '../../src/server/cockpit-unreviewed-augment.js'
import { createRuntimeStore } from '../../src/server/runtime-store.js'

// M43 accept-gate Phase 1 — 真集成测试（禁 mock）：
// - 真 createRuntimeStore + 真 sqlite v33 migration + 真 PTY agent-manager（不启动 agent）
// - 真 dispatch ledger + 真 team-operations.reportTask / acceptTask
// - 验证：flag on/off 双路径、accept gate 真挡（reported 未 accept tasks.md [~] 不是 [x]）、
//        reviews_dispatch_id 精确配对消解、scope 外 dispatch 不受影响、rejected → re-report 清回 pending、
//        PM 自审反铁律守护（accept --reason 必须引 reviewer dispatch_id）。

const tempDirs: string[] = []
const stores: Array<ReturnType<typeof createRuntimeStore>> = []

afterEach(async () => {
  // 必须先关掉 runtime store 的 sqlite 连接，再 rmSync 数据目录；
  // 否则文件句柄 leak 让后续测试拿到悬挂状态导致 flaky（钟馗第二轮发现）。
  await Promise.all(
    stores.splice(0).map(async (store) => {
      try {
        await store.close()
      } catch {
        // 忽略关闭异常，重点是把句柄释放。
      }
    })
  )
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, maxRetries: 10, recursive: true, retryDelay: 50 })
  }
  vi.unstubAllEnvs()
})

beforeEach(() => {
  vi.unstubAllEnvs()
})

const setup = (options: { gate?: 'default' | 'on' | 'off'; gateOn?: boolean } = {}) => {
  const gate =
    options.gate ?? (options.gateOn === true ? 'on' : options.gateOn === false ? 'off' : 'default')
  if (gate === 'on') {
    vi.stubEnv('HIVE_ACCEPT_GATE', '1')
  } else if (gate === 'off') {
    vi.stubEnv('HIVE_ACCEPT_GATE', '0')
  } else {
    delete process.env.HIVE_ACCEPT_GATE
    applyRuntimeEnvDefaults(process.env)
  }
  const dataDir = mkdtempSync(join(tmpdir(), 'hive-m43-data-'))
  tempDirs.push(dataDir)
  const store = createRuntimeStore({ agentManager: createAgentManager(), dataDir })
  stores.push(store)
  const workspacePath = mkdtempSync(join(tmpdir(), 'hive-m43-ws-'))
  tempDirs.push(workspacePath)
  // 准备 .hive/tasks.md 让 recordDispatchDone 真正能写文件。
  mkdirSync(join(workspacePath, '.hive'), { recursive: true })
  writeFileSync(
    join(workspacePath, '.hive', 'tasks.md'),
    `# Tasks\n\n## In progress\n\n## Done\n`,
    'utf8'
  )
  const workspace = store.createWorkspace(workspacePath, 'M43 accept-gate')
  return { dataDir, store, workspace, workspacePath }
}

const addClaudeCoder = (
  store: ReturnType<typeof createRuntimeStore>,
  workspaceId: string,
  name = '关羽'
) => {
  const worker = store.addWorker(workspaceId, { name, role: 'coder' })
  store.configureAgentLaunch(workspaceId, worker.id, {
    command: 'claude',
    commandPresetId: 'claude',
  })
  return worker
}

const addReviewer = (
  store: ReturnType<typeof createRuntimeStore>,
  workspaceId: string,
  name = '钟馗'
) => {
  const worker = store.addWorker(workspaceId, { name, role: 'reviewer' })
  store.configureAgentLaunch(workspaceId, worker.id, {
    command: 'codex',
    commandPresetId: 'codex',
  })
  return worker
}

const readTasksLines = (workspacePath: string) =>
  readFileSync(join(workspacePath, '.hive', 'tasks.md'), 'utf8').split(/\r?\n/u)

const findDispatchLine = (lines: string[], dispatchId: string) => {
  const shortId = dispatchId.slice(0, 8)
  return lines.find((line) => line.includes(`dispatch \`${shortId}\``)) ?? ''
}

describe('M43 accept-gate Phase 1 — real store integration', () => {
  test('env 未设时启动默认开启：claude 真 src 改动进入 review pending', async () => {
    const { store, workspace, workspacePath } = setup()
    const coder = addClaudeCoder(store, workspace.id)
    const dispatch = await store.dispatchTask(workspace.id, coder.id, '改 src/foo.ts')
    store.reportTask(workspace.id, coder.id, {
      dispatchId: dispatch.id,
      text: '改了 src/foo.ts，新增测试',
    })

    const line = findDispatchLine(readTasksLines(workspacePath), dispatch.id)
    expect(process.env.HIVE_ACCEPT_GATE).toBe('1')
    expect(line).toMatch(/^- \[~\]/u)
    const persisted = store.listDispatches(workspace.id).find((d) => d.id === dispatch.id)
    expect(persisted?.reviewStatus).toBe('pending')
  })

  test('flag=0（显式关闭）：reportTask 走旧路径——tasks.md 打 [x]，review_status 保持 NULL（逃生阀）', async () => {
    const { store, workspace, workspacePath } = setup({ gate: 'off' })
    const coder = addClaudeCoder(store, workspace.id)
    const dispatch = await store.dispatchTask(workspace.id, coder.id, '改 src/foo.ts')
    store.reportTask(workspace.id, coder.id, {
      dispatchId: dispatch.id,
      text: '改了 src/foo.ts，新增测试',
    })

    const line = findDispatchLine(readTasksLines(workspacePath), dispatch.id)
    expect(line).toMatch(/^- \[x\]/u)
    const persisted = store.listDispatches(workspace.id).find((d) => d.id === dispatch.id)
    expect(persisted?.reviewStatus).toBeNull()
    expect(persisted?.acceptVerdict).toBeNull()
  })

  test('flag=1 + claude coder + 真 src 改动：tasks.md [~] 中间态，review_status=pending', async () => {
    const { store, workspace, workspacePath } = setup({ gateOn: true })
    const coder = addClaudeCoder(store, workspace.id)
    const dispatch = await store.dispatchTask(workspace.id, coder.id, '改 src/foo.ts')
    store.reportTask(workspace.id, coder.id, {
      dispatchId: dispatch.id,
      text: '改了 src/foo.ts',
    })

    const line = findDispatchLine(readTasksLines(workspacePath), dispatch.id)
    expect(line).toMatch(/^- \[~\]/u)
    const persisted = store.listDispatches(workspace.id).find((d) => d.id === dispatch.id)
    expect(persisted?.reviewStatus).toBe('pending')
  })

  test('flag=1 + 非 claude coder：scope 外，tasks.md 仍 [x]，review_status 保持 NULL', async () => {
    const { store, workspace, workspacePath } = setup({ gateOn: true })
    // codex coder（非 claude）→ 不在 scope。
    const codexCoder = store.addWorker(workspace.id, { name: '黄忠', role: 'coder' })
    store.configureAgentLaunch(workspace.id, codexCoder.id, {
      command: 'codex',
      commandPresetId: 'codex',
    })
    const dispatch = await store.dispatchTask(workspace.id, codexCoder.id, '改 src/bar.ts')
    store.reportTask(workspace.id, codexCoder.id, {
      dispatchId: dispatch.id,
      text: '改了 src/bar.ts',
    })

    const line = findDispatchLine(readTasksLines(workspacePath), dispatch.id)
    expect(line).toMatch(/^- \[x\]/u)
    const persisted = store.listDispatches(workspace.id).find((d) => d.id === dispatch.id)
    expect(persisted?.reviewStatus).toBeNull()
  })

  test('flag=1 + report-only spike：scope 外，tasks.md 仍 [x]', async () => {
    const { store, workspace, workspacePath } = setup({ gateOn: true })
    const coder = addClaudeCoder(store, workspace.id, '马超')
    const dispatch = await store.dispatchTask(workspace.id, coder.id, '调研')
    store.reportTask(workspace.id, coder.id, {
      dispatchId: dispatch.id,
      text: '纯调研，未改产品代码',
    })

    const line = findDispatchLine(readTasksLines(workspacePath), dispatch.id)
    expect(line).toMatch(/^- \[x\]/u)
    const persisted = store.listDispatches(workspace.id).find((d) => d.id === dispatch.id)
    expect(persisted?.reviewStatus).toBeNull()
  })

  test('reviewer 主路径 --reviews + --verdict accepted：精确链接 + accept_verdict 写入 + tasks.md [~]→[x]', async () => {
    const { store, workspace, workspacePath } = setup({ gateOn: true })
    const coder = addClaudeCoder(store, workspace.id)
    const reviewer = addReviewer(store, workspace.id)

    // 1) coder reported（in scope）→ pending + [~]
    const coderDispatch = await store.dispatchTask(workspace.id, coder.id, '改 src/foo.ts')
    store.reportTask(workspace.id, coder.id, {
      dispatchId: coderDispatch.id,
      evidence: ['diff: src/foo.ts +12/-2', 'pnpm exec vitest run tests/foo.test.ts'],
      text: '改了 src/foo.ts',
    })
    expect(findDispatchLine(readTasksLines(workspacePath), coderDispatch.id)).toMatch(/^- \[~\]/u)
    expect(findDispatchLine(readTasksLines(workspacePath), coderDispatch.id)).toContain(
      'diff: src/foo.ts +12/-2'
    )

    // 2) reviewer report --reviews <coder.id> --verdict accepted --reason "..."
    const reviewerDispatch = await store.dispatchTask(
      workspace.id,
      reviewer.id,
      `审 ${coderDispatch.id.slice(0, 8)}`
    )
    store.reportTask(workspace.id, reviewer.id, {
      dispatchId: reviewerDispatch.id,
      text: '0 blocking, ship',
      reviewsDispatchId: coderDispatch.id,
      verdict: 'accepted',
      verdictReason: '测试覆盖完整 + 0 blocking',
    })

    // 3) 验证 accept_verdict 落在被审 coder dispatch 上 + reviewer dispatch 的 reviews_dispatch_id 精确链接
    const reloadCoder = store.listDispatches(workspace.id).find((d) => d.id === coderDispatch.id)
    expect(reloadCoder?.reviewStatus).toBe('accepted')
    expect(reloadCoder?.acceptVerdict?.verdict).toBe('accepted')
    expect(reloadCoder?.acceptVerdict?.byAgentId).toBe(reviewer.id)
    expect(reloadCoder?.acceptVerdict?.reason).toContain('测试覆盖')
    expect(reloadCoder?.acceptVerdict?.evidence).toEqual([
      'diff: src/foo.ts +12/-2',
      'pnpm exec vitest run tests/foo.test.ts',
    ])
    const reloadReviewer = store
      .listDispatches(workspace.id)
      .find((d) => d.id === reviewerDispatch.id)
    expect(reloadReviewer?.reviewsDispatchId).toBe(coderDispatch.id)

    // 4) tasks.md 被审 coder 行从 [~] 升 [x]
    expect(findDispatchLine(readTasksLines(workspacePath), coderDispatch.id)).toMatch(/^- \[x\]/u)
  })

  test('reviewer --verdict rejected：被审 coder review_status=rejected，tasks.md 保持 [~]，aiAction 带原因', async () => {
    const { store, workspace, workspacePath } = setup({ gateOn: true })
    const coder = addClaudeCoder(store, workspace.id)
    const reviewer = addReviewer(store, workspace.id)
    const coderDispatch = await store.dispatchTask(workspace.id, coder.id, '改 src/foo.ts')
    store.reportTask(workspace.id, coder.id, {
      dispatchId: coderDispatch.id,
      text: '改了 src/foo.ts',
    })

    const reviewerDispatch = await store.dispatchTask(workspace.id, reviewer.id, '审')
    store.reportTask(workspace.id, reviewer.id, {
      dispatchId: reviewerDispatch.id,
      text: 'blocking 1',
      reviewsDispatchId: coderDispatch.id,
      verdict: 'rejected',
      verdictReason: 'blocking #1: 鉴权缺失',
    })

    expect(findDispatchLine(readTasksLines(workspacePath), coderDispatch.id)).toMatch(/^- \[~\]/u)
    const reloaded = store.listDispatches(workspace.id).find((d) => d.id === coderDispatch.id)
    expect(reloaded?.reviewStatus).toBe('rejected')

    // unreviewed-code aiAction 应附带 rejected 原因
    const future = Date.now() + 10 * 60_000
    const result = resolveCockpitUnreviewedCode(store, workspace.id, future)
    const action = result.apply([]).find((a) => a.type === 'unreviewed_code')
    expect(action?.text).toContain('rejected')
    expect(action?.text).toContain('鉴权缺失')
  })

  test('rejected → worker re-report：review_status 自动清回 pending（不再带旧 verdict）', async () => {
    const { store, workspace, workspacePath } = setup({ gateOn: true })
    const coder = addClaudeCoder(store, workspace.id)
    const reviewer = addReviewer(store, workspace.id)

    // 第一轮：reported → rejected
    const coderDispatch = await store.dispatchTask(workspace.id, coder.id, '改 src/foo.ts')
    store.reportTask(workspace.id, coder.id, {
      dispatchId: coderDispatch.id,
      text: '改了 src/foo.ts',
    })
    const reviewerDispatch = await store.dispatchTask(workspace.id, reviewer.id, '审')
    store.reportTask(workspace.id, reviewer.id, {
      dispatchId: reviewerDispatch.id,
      text: 'blocking 1',
      reviewsDispatchId: coderDispatch.id,
      verdict: 'rejected',
      verdictReason: '缺鉴权',
    })
    expect(
      store.listDispatches(workspace.id).find((d) => d.id === coderDispatch.id)?.reviewStatus
    ).toBe('rejected')

    // 第二轮：worker 重新派单 + 重新 report（修了，进入新 pending）
    const coderDispatch2 = await store.dispatchTask(workspace.id, coder.id, '改 src/foo.ts 再修')
    store.reportTask(workspace.id, coder.id, {
      dispatchId: coderDispatch2.id,
      text: '修了鉴权 + 加测试',
    })
    const reloadedSecond = store
      .listDispatches(workspace.id)
      .find((d) => d.id === coderDispatch2.id)
    expect(reloadedSecond?.reviewStatus).toBe('pending')
    expect(reloadedSecond?.acceptVerdict).toBeNull()
    expect(findDispatchLine(readTasksLines(workspacePath), coderDispatch2.id)).toMatch(/^- \[~\]/u)
  })

  test('PM 旁路 acceptTask：reason 必须引 reviewer dispatch_id；不引拒绝（守 PM 自审反铁律）', async () => {
    const { store, workspace } = setup({ gateOn: true })
    const coder = addClaudeCoder(store, workspace.id)
    const orchestratorId = `${workspace.id}:orchestrator`
    const coderDispatch = await store.dispatchTask(workspace.id, coder.id, '改 src/foo.ts')
    store.reportTask(workspace.id, coder.id, {
      dispatchId: coderDispatch.id,
      text: '改了 src/foo.ts',
    })

    // 不引 reviewer dispatch_id（reason 里没 8 位 hex）→ 拒
    expect(() =>
      store.acceptTask(workspace.id, {
        dispatchId: coderDispatch.id,
        fromAgentId: orchestratorId,
        reason: '我看了 diff，没问题',
      })
    ).toThrow(/reviewer dispatch_id/i)

    // 引 reviewer dispatch_id 但 reviewer 不存在 → 拒
    expect(() =>
      store.acceptTask(workspace.id, {
        dispatchId: coderDispatch.id,
        fromAgentId: orchestratorId,
        reason: 'reviewer dispatch deadbeef 看过了',
      })
    ).toThrow(/reviewer/i)

    // 创建 reviewer + reviewer reported → PM 拿真 reviewer dispatch_id accept 通过
    const reviewer = addReviewer(store, workspace.id)
    const reviewerDispatch = await store.dispatchTask(workspace.id, reviewer.id, '审')
    store.reportTask(workspace.id, reviewer.id, {
      dispatchId: reviewerDispatch.id,
      text: '0 blocking, ship',
      reviewsDispatchId: coderDispatch.id,
      verdict: 'accepted',
      verdictReason: '0 blocking, ship',
    })
    const result = store.acceptTask(workspace.id, {
      dispatchId: coderDispatch.id,
      fromAgentId: orchestratorId,
      reason: `钟馗 ${reviewerDispatch.id} 0 blocking, 我看过 diff`,
    })
    expect(result.dispatch.reviewStatus).toBe('accepted')
    expect(result.dispatch.acceptVerdict?.byAgentId).toBe(orchestratorId)
  })

  test('PM acceptTask does not falsely reject when the referenced reviewer dispatch is beyond the first 1000 history rows', async () => {
    const { dataDir, store, workspace } = setup({ gateOn: true })
    const coder = addClaudeCoder(store, workspace.id)
    const reviewer = addReviewer(store, workspace.id)
    const orchestratorId = `${workspace.id}:orchestrator`
    const filler = store.addWorker(workspace.id, { name: '历史工蜂', role: 'coder' })

    const coderDispatch = await store.dispatchTask(workspace.id, coder.id, '改 src/foo.ts')
    store.reportTask(workspace.id, coder.id, {
      dispatchId: coderDispatch.id,
      text: '改了 src/foo.ts',
    })

    const db = new Database(join(dataDir, 'runtime.sqlite'))
    try {
      const insert = db.prepare(
        `INSERT INTO dispatches (
           id, workspace_id, from_agent_id, to_agent_id, text, status, created_at,
           delivered_at, submitted_at, reported_at, report_text, artifacts
         ) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?)`
      )
      const now = Date.now()
      const tx = db.transaction(() => {
        for (let index = 0; index < 1005; index += 1) {
          insert.run(
            `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
            workspace.id,
            orchestratorId,
            filler.id,
            `历史派单 ${index}`,
            now + index,
            now + index,
            now + index,
            now + index,
            '历史完成',
            '[]'
          )
        }
      })
      tx()
    } finally {
      db.close()
    }

    const reviewerDispatch = await store.dispatchTask(workspace.id, reviewer.id, '审大历史尾部')
    store.reportTask(workspace.id, reviewer.id, {
      dispatchId: reviewerDispatch.id,
      text: '0 blocking, ship',
      reviewsDispatchId: coderDispatch.id,
      verdict: 'accepted',
      verdictReason: '0 blocking, ship',
    })

    const result = store.acceptTask(workspace.id, {
      dispatchId: coderDispatch.id,
      fromAgentId: orchestratorId,
      reason: `钟馗 ${reviewerDispatch.id} 已审过，0 blocking`,
    })

    expect(result.dispatch.reviewStatus).toBe('accepted')
    expect(result.dispatch.acceptVerdict?.reason).toContain(reviewerDispatch.id)
  })

  test('flag=0 时 acceptTask 直接拒（accept gate disabled）', async () => {
    const { store, workspace } = setup({ gate: 'off' })
    const coder = addClaudeCoder(store, workspace.id)
    const coderDispatch = await store.dispatchTask(workspace.id, coder.id, '改 src/foo.ts')
    store.reportTask(workspace.id, coder.id, {
      dispatchId: coderDispatch.id,
      text: '改了 src/foo.ts',
    })
    expect(() =>
      store.acceptTask(workspace.id, {
        dispatchId: coderDispatch.id,
        fromAgentId: `${workspace.id}:orchestrator`,
        reason: 'reviewer abcd1234',
      })
    ).toThrow(/disabled/i)
  })

  test('精确链接 accepted 后 unreviewed-code 计数消解（M34 启发式不再误报）', async () => {
    const { store, workspace } = setup({ gateOn: true })
    const coder = addClaudeCoder(store, workspace.id)
    const reviewer = addReviewer(store, workspace.id)
    const coderDispatch = await store.dispatchTask(workspace.id, coder.id, '改 src/foo.ts')
    store.reportTask(workspace.id, coder.id, {
      dispatchId: coderDispatch.id,
      text: '改了 src/foo.ts',
    })

    const future = Date.now() + 10 * 60_000
    // accept 之前 → 计数 ≥1
    expect(resolveCockpitUnreviewedCode(store, workspace.id, future).count).toBeGreaterThanOrEqual(
      1
    )

    // reviewer report accepted → 精确链接，计数应回 0
    const reviewerDispatch = await store.dispatchTask(workspace.id, reviewer.id, '审')
    store.reportTask(workspace.id, reviewer.id, {
      dispatchId: reviewerDispatch.id,
      text: 'ok',
      reviewsDispatchId: coderDispatch.id,
      verdict: 'accepted',
      verdictReason: '审过了',
    })
    expect(resolveCockpitUnreviewedCode(store, workspace.id, future).count).toBe(0)
  })

  // ↓↓↓ 钟馗审 blocking #1 红绿：反铁律绕过 3 路径必拒。

  test('B1 绕过路径 1：reviewer 被派但未 report → acceptTask 必拒', async () => {
    const { store, workspace } = setup({ gateOn: true })
    const coder = addClaudeCoder(store, workspace.id)
    const reviewer = addReviewer(store, workspace.id)
    const orchestratorId = `${workspace.id}:orchestrator`
    const coderDispatch = await store.dispatchTask(workspace.id, coder.id, '改 src/foo.ts')
    store.reportTask(workspace.id, coder.id, {
      dispatchId: coderDispatch.id,
      text: '改了 src/foo.ts',
    })
    // 给 reviewer 派一条但**不**让它 report —— 在过去这个 hex 已存在但未 reported 就能绕过。
    const danglingReviewerDispatch = await store.dispatchTask(workspace.id, reviewer.id, '审一下')
    expect(() =>
      store.acceptTask(workspace.id, {
        dispatchId: coderDispatch.id,
        fromAgentId: orchestratorId,
        reason: `钟馗 ${danglingReviewerDispatch.id} 我看过`,
      })
    ).toThrow(/has not reported yet|not reported|reviewer/i)
  })

  test('B1 绕过路径 2：reviewer dispatch 的 reportedAt 早于 coder reportedAt → acceptTask 必拒', async () => {
    const { store, workspace } = setup({ gateOn: true })
    const coder = addClaudeCoder(store, workspace.id)
    const reviewer = addReviewer(store, workspace.id)
    const orchestratorId = `${workspace.id}:orchestrator`

    // 先让 reviewer 派一条**别的**单并 report（例如审了上一轮 / 文档），其 reportedAt 早于本 coder。
    const oldReviewerDispatch = await store.dispatchTask(workspace.id, reviewer.id, '审旧')
    store.reportTask(workspace.id, reviewer.id, {
      dispatchId: oldReviewerDispatch.id,
      text: '历史审，0 blocking',
    })
    // 等几毫秒确保 coder.reportedAt > reviewer.reportedAt
    await new Promise((resolve) => setTimeout(resolve, 5))
    const coderDispatch = await store.dispatchTask(workspace.id, coder.id, '改 src/foo.ts')
    // 再等一拍，确保 coder.reportedAt 真大于 reviewer
    await new Promise((resolve) => setTimeout(resolve, 5))
    store.reportTask(workspace.id, coder.id, {
      dispatchId: coderDispatch.id,
      text: '改了 src/foo.ts',
    })

    expect(() =>
      store.acceptTask(workspace.id, {
        dispatchId: coderDispatch.id,
        fromAgentId: orchestratorId,
        reason: `钟馗 ${oldReviewerDispatch.id} 我看过`,
      })
    ).toThrow(/reported before coder|reviewer/i)
  })

  test('B1 同毫秒绕过：reviewer 与 coder reportedAt 同 ms 但 reviewer.sequence < coder.sequence → 必拒（钟馗第二轮 blocking）', async () => {
    const { dataDir, store, workspace } = setup({ gateOn: true })
    const coder = addClaudeCoder(store, workspace.id)
    const reviewer = addReviewer(store, workspace.id)
    const orchestratorId = `${workspace.id}:orchestrator`

    const coderDispatch = await store.dispatchTask(workspace.id, coder.id, '改 src/foo.ts')
    store.reportTask(workspace.id, coder.id, {
      dispatchId: coderDispatch.id,
      text: '改了 src/foo.ts',
    })
    const reviewerDispatch = await store.dispatchTask(workspace.id, reviewer.id, '审')
    store.reportTask(workspace.id, reviewer.id, {
      dispatchId: reviewerDispatch.id,
      text: '0 blocking',
      reviewsDispatchId: coderDispatch.id,
      verdict: 'accepted',
      verdictReason: '0 blocking',
    })

    // 直接捅 sqlite：把 reviewer.reported_at 改成与 coder 同 ms；reviewer.sequence 早于 coder.sequence
    // （sequence 由 INSERT 顺序决定，coder 先派肯定 sequence 更小——所以这里反过来用 reviewer 早派
    // 的真实场景；实测里：上面 dispatchTask 顺序 coder 先 reviewer 后，所以 reviewer.sequence > coder。
    // 要构造 reviewer.sequence < coder 的同 ms case，直接对换两条 sequence 值即可——这是 SQL 真实可达
    // 的攻击面：恶意 PM 派 reviewer 在 coder 前并 report 后回头改 ms 也能凑出 reviewer.seq < coder.seq）。
    const db = new Database(join(dataDir, 'runtime.sqlite'))
    try {
      const coderRow = db
        .prepare('SELECT sequence, reported_at FROM dispatches WHERE id = ?')
        .get(coderDispatch.id) as { sequence: number; reported_at: number }
      const reviewerRow = db
        .prepare('SELECT sequence, reported_at FROM dispatches WHERE id = ?')
        .get(reviewerDispatch.id) as { sequence: number; reported_at: number }
      // 同 ms：让 reviewer 与 coder reportedAt 完全相同；reviewer.sequence 比 coder.sequence 小
      // （直接对换两个 sequence 值——这是 SQL 写入路径真实可达的）。
      const sameMs = coderRow.reported_at
      db.prepare('UPDATE dispatches SET reported_at = ?, sequence = ? WHERE id = ?').run(
        sameMs,
        coderRow.sequence + 10, // coder 拿更大的 sequence
        coderDispatch.id
      )
      db.prepare('UPDATE dispatches SET reported_at = ?, sequence = ? WHERE id = ?').run(
        sameMs,
        coderRow.sequence, // reviewer 拿原 coder 的小 sequence
        reviewerDispatch.id
      )
      // 验证我们真的写入了：reviewer.sequence < coder.sequence
      const reviewerNow = db
        .prepare('SELECT sequence, reported_at FROM dispatches WHERE id = ?')
        .get(reviewerDispatch.id) as { sequence: number; reported_at: number }
      const coderNow = db
        .prepare('SELECT sequence, reported_at FROM dispatches WHERE id = ?')
        .get(coderDispatch.id) as { sequence: number; reported_at: number }
      expect(reviewerNow.reported_at).toBe(coderNow.reported_at)
      expect(reviewerNow.sequence).toBeLessThan(coderNow.sequence)
      // 防御性：原 reviewerRow.sequence 早于本次写入的（即 reviewer 真的先派）—— sanity check
      void reviewerRow
    } finally {
      db.close()
    }

    expect(() =>
      store.acceptTask(workspace.id, {
        dispatchId: coderDispatch.id,
        fromAgentId: orchestratorId,
        reason: `钟馗 ${reviewerDispatch.id} 我看过`,
      })
    ).toThrow(/did not report strictly after coder|reviewer/i)
  })

  test('B1 同毫秒合法：reviewer 与 coder reportedAt 同 ms 但 reviewer.sequence > coder.sequence → 通过', async () => {
    const { dataDir, store, workspace } = setup({ gateOn: true })
    const coder = addClaudeCoder(store, workspace.id)
    const reviewer = addReviewer(store, workspace.id)
    const orchestratorId = `${workspace.id}:orchestrator`

    const coderDispatch = await store.dispatchTask(workspace.id, coder.id, '改 src/foo.ts')
    store.reportTask(workspace.id, coder.id, {
      dispatchId: coderDispatch.id,
      text: '改了 src/foo.ts',
    })
    const reviewerDispatch = await store.dispatchTask(workspace.id, reviewer.id, '审')
    store.reportTask(workspace.id, reviewer.id, {
      dispatchId: reviewerDispatch.id,
      text: '0 blocking',
      reviewsDispatchId: coderDispatch.id,
      verdict: 'accepted',
      verdictReason: '0 blocking',
    })
    expect(coderDispatch.sequence).not.toBeNull()
    expect(reviewerDispatch.sequence).not.toBeNull()
    expect(reviewerDispatch.sequence ?? 0).toBeGreaterThan(coderDispatch.sequence ?? 0)

    // 同 ms 但 reviewer.sequence 严格大于 coder.sequence —— 直接把 reviewer.reported_at 改成与 coder 一致。
    const db = new Database(join(dataDir, 'runtime.sqlite'))
    try {
      const coderRow = db
        .prepare('SELECT sequence, reported_at FROM dispatches WHERE id = ?')
        .get(coderDispatch.id) as { sequence: number; reported_at: number }
      db.prepare('UPDATE dispatches SET reported_at = ? WHERE id = ?').run(
        coderRow.reported_at,
        reviewerDispatch.id
      )
    } finally {
      db.close()
    }

    const result = store.acceptTask(workspace.id, {
      dispatchId: coderDispatch.id,
      fromAgentId: orchestratorId,
      reason: `钟馗 ${reviewerDispatch.id} 我看过`,
    })
    expect(result.dispatch.reviewStatus).toBe('accepted')
    expect(result.dispatch.acceptVerdict?.byAgentId).toBe(orchestratorId)
  })

  test('B1 绕过路径 3：reviewer dispatch.reviewsDispatchId 指向别条 coder → acceptTask 必拒', async () => {
    const { store, workspace } = setup({ gateOn: true })
    const coderA = addClaudeCoder(store, workspace.id, '关羽')
    const coderB = addClaudeCoder(store, workspace.id, '赵云')
    const reviewer = addReviewer(store, workspace.id)
    const orchestratorId = `${workspace.id}:orchestrator`

    // 两条 coder 都 reported
    const coderADispatch = await store.dispatchTask(workspace.id, coderA.id, '改 src/foo.ts')
    store.reportTask(workspace.id, coderA.id, {
      dispatchId: coderADispatch.id,
      text: '改了 src/foo.ts',
    })
    const coderBDispatch = await store.dispatchTask(workspace.id, coderB.id, '改 src/bar.ts')
    store.reportTask(workspace.id, coderB.id, {
      dispatchId: coderBDispatch.id,
      text: '改了 src/bar.ts',
    })

    // reviewer 明确审 coderB（reviewer.reviewsDispatchId == coderBDispatch.id）
    const reviewerDispatch = await store.dispatchTask(workspace.id, reviewer.id, '审 coderB')
    store.reportTask(workspace.id, reviewer.id, {
      dispatchId: reviewerDispatch.id,
      text: '0 blocking',
      reviewsDispatchId: coderBDispatch.id,
      verdict: 'accepted',
      verdictReason: 'B 那条 0 blocking',
    })

    // PM 想用同一 reviewer dispatch_id 去 accept coderA → 必须拒（reviewer 审的是 B，不是 A）
    expect(() =>
      store.acceptTask(workspace.id, {
        dispatchId: coderADispatch.id,
        fromAgentId: orchestratorId,
        reason: `钟馗 ${reviewerDispatch.id} 我看过`,
      })
    ).toThrow(/linked to a different coder dispatch|reviewer/i)
  })

  test('B1 绕过路径 4：reviewer 已 report 但未 link 本 coder → acceptTask 必拒', async () => {
    const { store, workspace } = setup({ gateOn: true })
    const coder = addClaudeCoder(store, workspace.id)
    const reviewer = addReviewer(store, workspace.id)
    const orchestratorId = `${workspace.id}:orchestrator`
    const coderDispatch = await store.dispatchTask(workspace.id, coder.id, '改 src/foo.ts')
    store.reportTask(workspace.id, coder.id, {
      dispatchId: coderDispatch.id,
      text: '改了 src/foo.ts',
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const reviewerDispatch = await store.dispatchTask(workspace.id, reviewer.id, '审')
    store.reportTask(workspace.id, reviewer.id, {
      dispatchId: reviewerDispatch.id,
      text: '0 blocking',
    })

    expect(() =>
      store.acceptTask(workspace.id, {
        dispatchId: coderDispatch.id,
        fromAgentId: orchestratorId,
        reason: `钟馗 ${reviewerDispatch.id} 我看过`,
      })
    ).toThrow(/not linked to this coder dispatch|未显式 link 本 coder|reviewer/i)
  })

  test('reviewer 主路径 scope 一致性 guard：--reviews target 不在 scope → reportTask 拒', async () => {
    const { store, workspace } = setup({ gateOn: true })
    const reviewer = addReviewer(store, workspace.id)
    // 让 codex coder（非 claude）出一个 reported dispatch；reviewer 试图 --reviews 这条
    const codexCoder = store.addWorker(workspace.id, { name: '黄忠', role: 'coder' })
    store.configureAgentLaunch(workspace.id, codexCoder.id, {
      command: 'codex',
      commandPresetId: 'codex',
    })
    const codexDispatch = await store.dispatchTask(workspace.id, codexCoder.id, '改 src/bar.ts')
    store.reportTask(workspace.id, codexCoder.id, {
      dispatchId: codexDispatch.id,
      text: '改了 src/bar.ts',
    })

    const reviewerDispatch = await store.dispatchTask(workspace.id, reviewer.id, '审')
    expect(() =>
      store.reportTask(workspace.id, reviewer.id, {
        dispatchId: reviewerDispatch.id,
        text: 'ok',
        reviewsDispatchId: codexDispatch.id,
        verdict: 'accepted',
        verdictReason: '看过',
      })
    ).toThrow(/out of accept-gate scope|scope/i)
  })

  test('启发式 fallback 仍生效（reviewer 没显式 --reviews 时，旧时序配对消解）', async () => {
    const { store, workspace } = setup({ gateOn: true })
    const coder = addClaudeCoder(store, workspace.id)
    const reviewer = addReviewer(store, workspace.id)
    const coderDispatch = await store.dispatchTask(workspace.id, coder.id, '改 src/foo.ts')
    store.reportTask(workspace.id, coder.id, {
      dispatchId: coderDispatch.id,
      text: '改了 src/foo.ts',
    })

    const future = Date.now() + 10 * 60_000
    expect(resolveCockpitUnreviewedCode(store, workspace.id, future).count).toBeGreaterThanOrEqual(
      1
    )

    // reviewer 在 coder report 之后 dispatched（但没用 --reviews 显式 link）→ 旧启发式仍消解
    await store.dispatchTask(workspace.id, reviewer.id, '审一下')
    expect(resolveCockpitUnreviewedCode(store, workspace.id, future).count).toBe(0)
  })
})
