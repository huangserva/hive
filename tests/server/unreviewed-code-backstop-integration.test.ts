import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { createAgentManager } from '../../src/server/agent-manager.js'
import { resolveCockpitUnreviewedCode } from '../../src/server/cockpit-unreviewed-augment.js'
import { buildMobileDashboard } from '../../src/server/routes-mobile.js'
import { createRuntimeStore } from '../../src/server/runtime-store.js'
import { resolveCommandPresetId } from '../../src/server/team-list-enrichment.js'

// M34 BLOCKER 返工：**穿透真实 RuntimeStore** 的边界集成测试（钟馗 按 AGENTS §9 要求；上一版只测纯函数、
// 手造带 commandPresetId 的 worker，漏掉了"真实 listWorkers 不含 preset → isClaudeCoder 恒 false → 生产里
// 整个功能形同虚设"的 BLOCKER）。本测走真实 createRuntimeStore + addWorker + configureAgentLaunch +
// dispatchTask + reportTask 的真实路径。不 mock PTY（§13）；createAgentManager 真实但不启动 agent。

const tempDirs: string[] = []
const stores: Array<{ close?: () => void }> = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  stores.splice(0)
})

const setup = () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hive-m34-data-'))
  tempDirs.push(dataDir)
  const store = createRuntimeStore({ agentManager: createAgentManager(), dataDir })
  stores.push(store)
  const workspacePath = mkdtempSync(join(tmpdir(), 'hive-m34-ws-'))
  tempDirs.push(workspacePath)
  const workspace = store.createWorkspace(workspacePath, 'M34 backstop')
  return { store, workspace }
}

describe('M34 unreviewed-code backstop — real RuntimeStore boundary', () => {
  test('claude launch config resolves preset even though raw listWorkers omits it (the BLOCKER)', () => {
    const { store, workspace } = setup()
    const worker = store.addWorker(workspace.id, { name: '关羽', role: 'coder' })
    store.configureAgentLaunch(workspace.id, worker.id, {
      command: 'claude',
      commandPresetId: 'claude',
    })

    // 这是上一版踩的坑：raw listWorkers **不含** commandPresetId（恒 undefined）。
    const raw = store.listWorkers(workspace.id).find((w) => w.id === worker.id)
    expect(raw?.commandPresetId).toBeUndefined()
    // 真实来源是 launch config——resolveCommandPresetId（边界 resolver 内部用的就是它）能解析出来。
    expect(resolveCommandPresetId(store, workspace.id, worker.id)).toBe('claude')
  })

  test('claude coder reported + no reviewer → dashboard & cockpit really surface unreviewed_code', async () => {
    const { store, workspace } = setup()
    const worker = store.addWorker(workspace.id, { name: '关羽', role: 'coder' })
    store.configureAgentLaunch(workspace.id, worker.id, {
      command: 'claude',
      commandPresetId: 'claude',
    })
    // 真实 dispatch 生命周期：派单 → 汇报（带真实代码改动文本）。
    await store.dispatchTask(workspace.id, worker.id, '改登录逻辑')
    store.reportTask(workspace.id, worker.id, { text: '改了 src/server/auth.ts，新增 3 个测试' })

    // reported 刚发生（在宽限内），注入未来 now 越过宽限，断言"未审"真出现。
    const future = Date.now() + 10 * 60_000

    // ① mobile dashboard 真实路径出计数。
    const dash = buildMobileDashboard(store, workspace.id, future)
    expect(dash.cockpit.unreviewed_code_dispatches).toBeGreaterThanOrEqual(1)
    expect(dash.cockpit.high_ai_actions).toBeGreaterThanOrEqual(1)

    // ② cockpit aiActions 真实路径出 unreviewed_code action（severity high / targetTab tasks）。
    const result = resolveCockpitUnreviewedCode(store, workspace.id, future)
    expect(result.count).toBeGreaterThanOrEqual(1)
    expect(result.summary.unreviewed.some((entry) => entry.toAgentId === worker.id)).toBe(true)
    const actions = result.apply([])
    const action = actions.find((a) => a.type === 'unreviewed_code')
    expect(action?.priority).toBe('high')
    expect(action?.targetTab).toBe('tasks')
    expect(action?.text).toContain('关羽')
  })

  test('after a reviewer dispatch is created, the flag clears (real store)', async () => {
    const { store, workspace } = setup()
    const coder = store.addWorker(workspace.id, { name: '关羽', role: 'coder' })
    store.configureAgentLaunch(workspace.id, coder.id, {
      command: 'claude',
      commandPresetId: 'claude',
    })
    await store.dispatchTask(workspace.id, coder.id, '改登录逻辑')
    store.reportTask(workspace.id, coder.id, { text: '改了 src/server/auth.ts' })

    const future = Date.now() + 10 * 60_000
    expect(resolveCockpitUnreviewedCode(store, workspace.id, future).count).toBeGreaterThanOrEqual(
      1
    )

    // 派一个 reviewer dispatch（在 coder report 之后）→ 消解。
    const reviewer = store.addWorker(workspace.id, { name: '钟馗', role: 'reviewer' })
    await store.dispatchTask(workspace.id, reviewer.id, '审一下关羽改的 auth.ts')

    const later = Date.now() + 20 * 60_000
    expect(resolveCockpitUnreviewedCode(store, workspace.id, later).count).toBe(0)
  })

  test('codex coder is NOT flagged in Phase 1 (real launch config)', async () => {
    const { store, workspace } = setup()
    const worker = store.addWorker(workspace.id, { name: '黄忠', role: 'coder' })
    store.configureAgentLaunch(workspace.id, worker.id, {
      command: 'codex',
      commandPresetId: 'codex',
    })
    await store.dispatchTask(workspace.id, worker.id, '改登录逻辑')
    store.reportTask(workspace.id, worker.id, { text: '改了 src/server/auth.ts' })

    const future = Date.now() + 10 * 60_000
    expect(resolveCockpitUnreviewedCode(store, workspace.id, future).count).toBe(0)
    expect(
      buildMobileDashboard(store, workspace.id, future).cockpit.unreviewed_code_dispatches
    ).toBe(0)
  })

  test('report-only spike from a claude coder is NOT flagged (real store)', async () => {
    const { store, workspace } = setup()
    const worker = store.addWorker(workspace.id, { name: '马超', role: 'coder' })
    store.configureAgentLaunch(workspace.id, worker.id, {
      command: 'claude',
      commandPresetId: 'claude',
    })
    await store.dispatchTask(workspace.id, worker.id, 'M34 设计 spike')
    store.reportTask(workspace.id, worker.id, {
      text: '【完成】M34 设计 spike：纯设计 + 深读现有代码，未改任何产品代码。',
    })

    const future = Date.now() + 10 * 60_000
    expect(resolveCockpitUnreviewedCode(store, workspace.id, future).count).toBe(0)
  })
})
