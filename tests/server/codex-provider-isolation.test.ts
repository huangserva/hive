import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { buildAgentRunBootstrap } from '../../src/server/agent-run-bootstrap.js'
import type { AgentSessionStore } from '../../src/server/agent-session-store.js'
import type { CommandPresetRecord } from '../../src/server/command-preset-store.js'
import {
  materializeCodexManagedHome,
  resolveCodexManagedHome,
  resolveCodexSessionRoot,
} from '../../src/server/provider-runtime-profile.js'
import { getCodexHome, snapshotCodexSessionIds } from '../../src/server/session-capture-codex.js'

const tempDirs: string[] = []
const makeTmp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

// 写一个 codex rollout session 文件：首行 JSONL 即 {payload:{id,cwd}}，session-capture-codex 据此解析。
const writeCodexSession = (codexHome: string, cwd: string, sessionId: string) => {
  const dir = join(codexHome, 'sessions', '2026', '05', '30')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `rollout-${sessionId}.jsonl`),
    `${JSON.stringify({ payload: { cwd, id: sessionId } })}\n`,
    'utf8'
  )
}

const codexPreset: CommandPresetRecord = {
  args: [],
  command: 'codex',
  displayName: 'Codex',
  env: {},
  id: 'codex',
  isBuiltin: true,
  resumeArgsTemplate: 'resume {session_id}',
  sessionIdCapture: { pattern: '~/.codex/sessions/**/*.jsonl', source: 'codex_session_jsonl_dir' },
  yoloArgsTemplate: null,
}

const claudePreset: CommandPresetRecord = {
  args: [],
  command: 'claude',
  displayName: 'Claude Code (CC)',
  env: {},
  id: 'claude',
  isBuiltin: true,
  resumeArgsTemplate: '--resume {session_id}',
  sessionIdCapture: {
    pattern: '~/.claude/projects/{encoded_cwd}/*.jsonl',
    source: 'claude_project_jsonl_dir',
  },
  yoloArgsTemplate: null,
}

const presetLookup = (id: string) =>
  id === 'codex' ? codexPreset : id === 'claude' ? claudePreset : undefined

const sessionStore = (sessionId?: string): AgentSessionStore => ({
  clearLastSessionId: () => {},
  getLastSessionId: () => sessionId,
  setLastSessionId: () => {},
})

const workspace = { id: 'ws-1', name: 'WS', path: '/tmp/codex-iso-cwd' }
const agent = { id: 'agent-a', name: '马超', role: 'coder', status: 'idle' as const }

// 让 source codex home（~/.codex）落到可控的 tmp HOME，测试不依赖、不污染真实用户目录。
let savedHome: string | undefined
let savedCodexHome: string | undefined
let fakeHome: string

beforeEach(() => {
  savedHome = process.env.HOME
  savedCodexHome = process.env.CODEX_HOME
  fakeHome = makeTmp('hive-fakehome-')
  process.env.HOME = fakeHome
  process.env.CODEX_HOME = undefined
  delete process.env.CODEX_HOME
})

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME
  else process.env.HOME = savedHome
  if (savedCodexHome === undefined) delete process.env.CODEX_HOME
  else process.env.CODEX_HOME = savedCodexHome
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

describe('codex managed home 路径解析', () => {
  test('两个不同 agent 解析到不同 managed home + 各自独立 session 根', () => {
    const dataDir = makeTmp('hive-state-')
    const homeA = resolveCodexManagedHome(dataDir, 'agent-a')
    const homeB = resolveCodexManagedHome(dataDir, 'agent-b')
    expect(homeA).not.toBe(homeB)
    expect(resolveCodexSessionRoot(homeA)).toBe(join(homeA, 'sessions'))
    expect(resolveCodexSessionRoot(homeB)).toBe(join(homeB, 'sessions'))
    // 即便 agentId 含 ':'（orchestrator）也不能塌缩到 worker 的 home。
    expect(resolveCodexManagedHome(dataDir, 'ws-1:orchestrator')).not.toBe(homeA)
  })

  test('同一 agent 跨调用稳定（重启后 resolve 到同一 home，managed authority 可复用）', () => {
    const dataDir = makeTmp('hive-state-')
    expect(resolveCodexManagedHome(dataDir, 'agent-a')).toBe(
      resolveCodexManagedHome(dataDir, 'agent-a')
    )
  })
})

describe('materializeCodexManagedHome 投影', () => {
  test('有 source 时投影 config.toml + auth.json，并建 sessions 根', () => {
    const sourceHome = makeTmp('hive-src-codex-')
    writeFileSync(join(sourceHome, 'config.toml'), 'model = "gpt-5-codex"\n', 'utf8')
    writeFileSync(join(sourceHome, 'auth.json'), '{"OPENAI_API_KEY":"sk-secret"}', 'utf8')
    const managedHome = join(makeTmp('hive-state-'), 'home')

    const profile = materializeCodexManagedHome({ managedHome, sourceHome })

    expect(existsSync(join(managedHome, 'sessions'))).toBe(true)
    expect(readFileSync(join(managedHome, 'config.toml'), 'utf8')).toBe('model = "gpt-5-codex"\n')
    expect(readFileSync(join(managedHome, 'auth.json'), 'utf8')).toBe(
      '{"OPENAI_API_KEY":"sk-secret"}'
    )
    expect(profile.env.CODEX_HOME).toBe(managedHome)
    expect(profile.env.CODEX_SESSION_ROOT).toBe(join(managedHome, 'sessions'))
  })

  test('source 无 config/auth 时写 stub config、不产出 auth.json', () => {
    const sourceHome = makeTmp('hive-src-empty-')
    const managedHome = join(makeTmp('hive-state-'), 'home')

    materializeCodexManagedHome({ managedHome, sourceHome })

    expect(readFileSync(join(managedHome, 'config.toml'), 'utf8')).toContain(
      'hive-managed codex home'
    )
    expect(existsSync(join(managedHome, 'auth.json'))).toBe(false)
  })
})

describe('两个 codex worker 物理隔离（不串 session）', () => {
  test('各自 managed home 的 sessions 互不可见', () => {
    const dataDir = makeTmp('hive-state-')
    const homeA = resolveCodexManagedHome(dataDir, 'agent-a')
    const homeB = resolveCodexManagedHome(dataDir, 'agent-b')
    mkdirSync(homeA, { recursive: true })
    mkdirSync(homeB, { recursive: true })
    // 同一 cwd 下两个 worker 各自起了一个 session，分别落在各自 managed home。
    writeCodexSession(homeA, workspace.path, 'sid-aaaaaaaa')
    writeCodexSession(homeB, workspace.path, 'sid-bbbbbbbb')

    const seenByA = snapshotCodexSessionIds(workspace.path, homeA)
    const seenByB = snapshotCodexSessionIds(workspace.path, homeB)

    expect([...seenByA]).toEqual(['sid-aaaaaaaa'])
    expect(seenByA.has('sid-bbbbbbbb')).toBe(false)
    expect([...seenByB]).toEqual(['sid-bbbbbbbb'])
    expect(seenByB.has('sid-aaaaaaaa')).toBe(false)
  })

  test('bootstrap 给每个 codex worker 钉死各自 CODEX_HOME，snapshot 读 managed 根', () => {
    const dataDir = makeTmp('hive-state-')
    const bootA = buildAgentRunBootstrap(
      workspace,
      'agent-a',
      { args: [], command: 'codex', commandPresetId: 'codex' },
      sessionStore(),
      presetLookup,
      { ...agent, id: 'agent-a' },
      dataDir
    )
    const bootB = buildAgentRunBootstrap(
      workspace,
      'agent-b',
      { args: [], command: 'codex', commandPresetId: 'codex' },
      sessionStore(),
      presetLookup,
      { ...agent, id: 'agent-b', name: '黄忠' },
      dataDir
    )

    const homeA = resolveCodexManagedHome(dataDir, 'agent-a')
    const homeB = resolveCodexManagedHome(dataDir, 'agent-b')
    expect(bootA.startEnv.CODEX_HOME).toBe(homeA)
    expect(bootB.startEnv.CODEX_HOME).toBe(homeB)
    expect(bootA.startEnv.CODEX_HOME).not.toBe(bootB.startEnv.CODEX_HOME)
    expect(bootA.startEnv.CODEX_SESSION_ROOT).toBe(join(homeA, 'sessions'))
    // 捕获 snapshot 必须扫 managed 根，而不是全局 ~/.codex。
    expect(bootA.sessionCaptureSnapshot?.root).toBe(homeA)
    // managed home 已真的物化（启动前 sessions 根存在）。
    expect(existsSync(join(homeA, 'sessions'))).toBe(true)
  })
})

describe('resume 与重启：用 managed authority，不回落全局', () => {
  test('resume 路径仍注入 managed CODEX_HOME（否则 codex 去全局找不到 managed session）', () => {
    const dataDir = makeTmp('hive-state-')
    const boot = buildAgentRunBootstrap(
      workspace,
      'agent-a',
      { args: [], command: 'codex', commandPresetId: 'codex' },
      sessionStore('019dc277-0e8e-75c1-9794-94929426288e'),
      presetLookup,
      agent,
      dataDir
    )

    // resume 生效：args 带 resume + id，且 snapshot 不再建（沿用持久化 authority）。
    expect(boot.startConfig.resumedSessionId).toBe('019dc277-0e8e-75c1-9794-94929426288e')
    expect(boot.startConfig.args).toEqual(['resume', '019dc277-0e8e-75c1-9794-94929426288e'])
    expect(boot.sessionCaptureSnapshot).toBeUndefined()
    // 关键：即便 snapshot 为空，CODEX_HOME 也必须是 managed home（resume 的核心修复点）。
    expect(boot.startEnv.CODEX_HOME).toBe(resolveCodexManagedHome(dataDir, 'agent-a'))
  })
})

describe('provider 隔离只作用于 codex（Phase 1 边界）', () => {
  test('claude agent 不被注入 managed CODEX_HOME，也不创建 codex managed 目录', () => {
    const dataDir = makeTmp('hive-state-')
    const boot = buildAgentRunBootstrap(
      workspace,
      'agent-a',
      { args: [], command: 'claude', commandPresetId: 'claude' },
      sessionStore(),
      presetLookup,
      agent,
      dataDir
    )

    expect(boot.startEnv.CODEX_HOME).toBeUndefined()
    expect(boot.startEnv.CODEX_SESSION_ROOT).toBeUndefined()
    expect(existsSync(join(dataDir, 'agents'))).toBe(false)
  })

  test('无 dataDir 时 codex 退回全局 ~/.codex（向后兼容，不破坏内存 runtime / 老路径）', () => {
    const boot = buildAgentRunBootstrap(
      workspace,
      'agent-a',
      { args: [], command: 'codex', commandPresetId: 'codex' },
      sessionStore(),
      presetLookup,
      agent
      // 不传 dataDir
    )

    // 退回全局：CODEX_HOME 来自 capture snapshot 的全局解析（~/.codex），非 managed。
    expect(boot.startEnv.CODEX_HOME).toBe(getCodexHome(codexPreset.sessionIdCapture?.pattern))
    expect(boot.startEnv.CODEX_HOME).toBe(join(fakeHome, '.codex'))
  })
})
