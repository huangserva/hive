import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { buildAgentRunBootstrap } from '../../src/server/agent-run-bootstrap.js'
import type { AgentSessionStore } from '../../src/server/agent-session-store.js'
import {
  buildAgentLegacyIdentityMarker,
  buildAgentSessionBindingMarker,
} from '../../src/server/agent-startup-instructions.js'
import type { CommandPresetRecord } from '../../src/server/command-preset-store.js'
import {
  materializeClaudeManagedHome,
  resolveClaudeManagedHome,
  resolveClaudeProjectsRoot,
  resolveClaudeSessionEnvRoot,
} from '../../src/server/provider-runtime-profile.js'
import { snapshotClaudeSessionIds } from '../../src/server/session-capture-claude.js'
import type { AgentSummary } from '../../src/shared/types.js'

// M25 Phase 2：真 fs（tmp 目录）+ 真 buildAgentRunBootstrap + 真 session-capture-claude，零 PTY（§13）。
// 测的是「decide claude managed HOME + session 隔离」的承重层：路径解析 / 物化投影 / env 注入 / capture
// 读 managed projects 根。CLAUDE managed home 走门控 HIVE_CLAUDE_MANAGED_HOME=1（默认关，向后兼容）。

const tempDirs: string[] = []
const makeTmp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

// 写一个 claude project session 文件：`<projectsRoot>/<encoded_cwd>/<sid>.jsonl`，
// session-capture-claude 据此列举。sid 必须是合法 uuid（SESSION_FILE 正则校验）。
const encodeCwd = (cwd: string) => cwd.replace(/[\\/:\s]/g, '-')
const writeClaudeSession = (projectsRoot: string, cwd: string, sessionId: string) => {
  const dir = join(projectsRoot, encodeCwd(cwd))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${sessionId}.jsonl`), `${JSON.stringify({ sessionId })}\n`, 'utf8')
}
// 合法 uuid（claude SESSION_FILE 正则要求 version∈[1-5]、variant∈[89ab]）。
const SID_A = '11111111-1111-4111-8111-111111111111'
const SID_B = '22222222-2222-4222-9222-222222222222'

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

const sessionStore = (sessionId?: string): AgentSessionStore => ({
  clearLastSessionId: () => {},
  getLastSessionId: () => sessionId,
  setLastSessionId: () => {},
})

const workspace = { id: 'ws-1', name: 'WS', path: '/tmp/claude-iso-cwd' }
const agent: AgentSummary = {
  description: '',
  id: 'agent-a',
  name: '马超',
  pendingTaskCount: 0,
  role: 'coder',
  status: 'idle',
  workspaceId: workspace.id,
}

// source claude home（~/.claude + ~/.claude.json）落到可控 tmp HOME，测试不依赖/不污染真实用户目录。
let fakeHome: string

const claudeProjectsRoot = () => join(fakeHome, '.claude', 'projects')

const claudePresetForFakeHome = (): CommandPresetRecord => ({
  ...claudePreset,
  sessionIdCapture: {
    pattern: `${claudeProjectsRoot()}/{encoded_cwd}/*.jsonl`,
    source: 'claude_project_jsonl_dir',
  },
})

const presetLookup = (id: string) =>
  id === 'claude' ? claudePresetForFakeHome() : id === 'codex' ? codexPreset : undefined

const managedClaudeOptions = () => ({
  claudeSourceHome: fakeHome,
  env: { ...process.env, HIVE_CLAUDE_MANAGED_HOME: '1' },
})

const seedSourceHome = () => {
  mkdirSync(join(fakeHome, '.claude'), { recursive: true })
  writeFileSync(join(fakeHome, '.claude', 'settings.json'), '{"theme":"dark"}', 'utf8')
  writeFileSync(join(fakeHome, '.claude', '.credentials.json'), '{"token":"sk-secret"}', 'utf8')
  writeFileSync(join(fakeHome, '.claude.json'), '{"oauthAccount":{"id":"acct"}}', 'utf8')
}

beforeEach(() => {
  fakeHome = makeTmp('hive-fakehome-')
})

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

describe('claude managed home 路径解析', () => {
  test('两个不同 agent 解析到不同 managed home + 各自独立 projects/session-env 根', () => {
    const dataDir = makeTmp('hive-state-')
    const homeA = resolveClaudeManagedHome(dataDir, 'agent-a')
    const homeB = resolveClaudeManagedHome(dataDir, 'agent-b')
    expect(homeA).not.toBe(homeB)
    // 契约硬约束：projects 根恒为 <home>/.claude/projects。
    expect(resolveClaudeProjectsRoot(homeA)).toBe(join(homeA, '.claude', 'projects'))
    expect(resolveClaudeSessionEnvRoot(homeA)).toBe(join(homeA, '.claude', 'session-env'))
    // 即便 agentId 含 ':'（orchestrator）也不能塌缩到 worker 的 home。
    expect(resolveClaudeManagedHome(dataDir, 'ws-1:orchestrator')).not.toBe(homeA)
  })

  test('同一 agent 跨调用稳定（重启后 resolve 到同一 home，managed authority 可复用）', () => {
    const dataDir = makeTmp('hive-state-')
    expect(resolveClaudeManagedHome(dataDir, 'agent-a')).toBe(
      resolveClaudeManagedHome(dataDir, 'agent-a')
    )
  })
})

describe('materializeClaudeManagedHome 投影', () => {
  test('有 source 时投影 settings.json / .credentials.json / .claude.json，建 projects+session-env 根', () => {
    seedSourceHome()
    const managedHome = join(makeTmp('hive-state-'), 'home')

    const profile = materializeClaudeManagedHome({ managedHome, sourceHome: fakeHome })

    expect(existsSync(join(managedHome, '.claude', 'projects'))).toBe(true)
    expect(existsSync(join(managedHome, '.claude', 'session-env'))).toBe(true)
    expect(readFileSync(join(managedHome, '.claude', 'settings.json'), 'utf8')).toBe(
      '{"theme":"dark"}'
    )
    expect(readFileSync(join(managedHome, '.claude', '.credentials.json'), 'utf8')).toBe(
      '{"token":"sk-secret"}'
    )
    expect(readFileSync(join(managedHome, '.claude.json'), 'utf8')).toBe(
      '{"oauthAccount":{"id":"acct"}}'
    )
    // 契约硬约束：HOME 是隔离边界，CLAUDE_PROJECTS_ROOT == <HOME>/.claude/projects。
    expect(profile.env.HOME).toBe(managedHome)
    expect(profile.env.CLAUDE_PROJECTS_ROOT).toBe(join(managedHome, '.claude', 'projects'))
  })

  test('source 无 settings/credentials/.claude.json 时不产出这些文件，但仍建 projects 根（不崩）', () => {
    const emptySource = makeTmp('hive-src-empty-')
    const managedHome = join(makeTmp('hive-state-'), 'home')

    materializeClaudeManagedHome({ managedHome, sourceHome: emptySource })

    expect(existsSync(join(managedHome, '.claude', 'projects'))).toBe(true)
    expect(existsSync(join(managedHome, '.claude', 'settings.json'))).toBe(false)
    expect(existsSync(join(managedHome, '.claude', '.credentials.json'))).toBe(false)
    expect(existsSync(join(managedHome, '.claude.json'))).toBe(false)
  })
})

describe('两个 claude worker 物理隔离（不串 session）', () => {
  test('各自 managed home 的 projects 互不可见', () => {
    const dataDir = makeTmp('hive-state-')
    const projA = resolveClaudeProjectsRoot(resolveClaudeManagedHome(dataDir, 'agent-a'))
    const projB = resolveClaudeProjectsRoot(resolveClaudeManagedHome(dataDir, 'agent-b'))
    mkdirSync(projA, { recursive: true })
    mkdirSync(projB, { recursive: true })
    // 同一 cwd 下两个 worker 各自起了一个 session，分别落在各自 managed projects 根。
    writeClaudeSession(projA, workspace.path, SID_A)
    writeClaudeSession(projB, workspace.path, SID_B)

    const seenByA = snapshotClaudeSessionIds(workspace.path, projA)
    const seenByB = snapshotClaudeSessionIds(workspace.path, projB)

    expect([...seenByA]).toEqual([SID_A])
    expect(seenByA.has(SID_B)).toBe(false)
    expect([...seenByB]).toEqual([SID_B])
    expect(seenByB.has(SID_A)).toBe(false)
  })

  test('bootstrap（门控开启）给每个 claude worker 钉死各自 HOME/CLAUDE_PROJECTS_ROOT，snapshot 读 managed 根', () => {
    const dataDir = makeTmp('hive-state-')
    const bootA = buildAgentRunBootstrap(
      workspace,
      'agent-a',
      { args: [], command: 'claude', commandPresetId: 'claude' },
      sessionStore(),
      presetLookup,
      { ...agent, id: 'agent-a' },
      dataDir,
      undefined,
      managedClaudeOptions()
    )
    const bootB = buildAgentRunBootstrap(
      workspace,
      'agent-b',
      { args: [], command: 'claude', commandPresetId: 'claude' },
      sessionStore(),
      presetLookup,
      { ...agent, id: 'agent-b', name: '黄忠' },
      dataDir,
      undefined,
      managedClaudeOptions()
    )

    const homeA = resolveClaudeManagedHome(dataDir, 'agent-a')
    const homeB = resolveClaudeManagedHome(dataDir, 'agent-b')
    expect(bootA.startEnv.HOME).toBe(homeA)
    expect(bootB.startEnv.HOME).toBe(homeB)
    expect(bootA.startEnv.HOME).not.toBe(bootB.startEnv.HOME)
    expect(bootA.startEnv.CLAUDE_PROJECTS_ROOT).toBe(resolveClaudeProjectsRoot(homeA))
    // 捕获 snapshot 必须扫 managed projects 根，而不是全局 ~/.claude/projects。
    expect(bootA.sessionCaptureSnapshot?.root).toBe(resolveClaudeProjectsRoot(homeA))
    // managed home 已真物化（启动前 projects 根存在）。
    expect(existsSync(resolveClaudeProjectsRoot(homeA))).toBe(true)
  })
})

describe('resume 与重启：用 managed authority，不回落全局', () => {
  test('resume 路径仍注入 managed HOME/CLAUDE_PROJECTS_ROOT，且校验扫 managed 根（非全局）', () => {
    const dataDir = makeTmp('hive-state-')
    // 模拟上一轮：managed home 已物化，且 managed projects 根里有一份带 binding marker 的会话文件。
    // claude resume 会校验「会话存在 + 内容含本 agent 的 binding/identity marker」——校验必须扫 managed 根。
    const home = resolveClaudeManagedHome(dataDir, 'agent-a')
    const projectsRoot = resolveClaudeProjectsRoot(home)
    mkdirSync(join(projectsRoot, encodeCwd(workspace.path)), { recursive: true })
    const marker = `${buildAgentSessionBindingMarker({ agent, workspace })}\n${buildAgentLegacyIdentityMarker({ agent, workspace })}`
    writeFileSync(
      join(projectsRoot, encodeCwd(workspace.path), `${SID_A}.jsonl`),
      `${JSON.stringify({ sessionId: SID_A })}\n${marker}\n`,
      'utf8'
    )

    const boot = buildAgentRunBootstrap(
      workspace,
      'agent-a',
      { args: [], command: 'claude', commandPresetId: 'claude' },
      sessionStore(SID_A),
      presetLookup,
      agent,
      dataDir,
      undefined,
      managedClaudeOptions()
    )

    // resume 生效：args 带 --resume + id，且 snapshot 不再建（沿用持久化 authority）。
    // 若校验扫的是全局 ~/.claude/projects（错误），就找不到这份 managed 会话 → resume 被丢弃 → 本测变红。
    expect(boot.startConfig.resumedSessionId).toBe(SID_A)
    expect(boot.startConfig.args).toEqual(['--resume', SID_A])
    expect(boot.sessionCaptureSnapshot).toBeUndefined()
    // 关键：即便 snapshot 为空，HOME / CLAUDE_PROJECTS_ROOT 也必须是 managed（resume 核心修复点）。
    expect(boot.startEnv.HOME).toBe(home)
    expect(boot.startEnv.CLAUDE_PROJECTS_ROOT).toBe(projectsRoot)
  })

  test('resume 校验只认 managed 根：会话只存在于全局 ~/.claude/projects 时，managed agent 拒绝 resume', () => {
    const dataDir = makeTmp('hive-state-')
    // 全局（fakeHome）projects 根里放一份会话，但 managed 根里没有 → managed agent 不得 resume 它。
    const globalProjects = claudeProjectsRoot()
    mkdirSync(join(globalProjects, encodeCwd(workspace.path)), { recursive: true })
    const marker = `${buildAgentSessionBindingMarker({ agent, workspace })}\n${buildAgentLegacyIdentityMarker({ agent, workspace })}`
    writeFileSync(
      join(globalProjects, encodeCwd(workspace.path), `${SID_A}.jsonl`),
      `${JSON.stringify({ sessionId: SID_A })}\n${marker}\n`,
      'utf8'
    )

    const boot = buildAgentRunBootstrap(
      workspace,
      'agent-a',
      { args: [], command: 'claude', commandPresetId: 'claude' },
      sessionStore(SID_A),
      presetLookup,
      agent,
      dataDir,
      undefined,
      managedClaudeOptions()
    )

    // managed 根里没有这份会话 → resume 被拒（隔离正确：不串全局历史）。
    expect(boot.startConfig.resumedSessionId).toBeUndefined()
    expect(boot.startConfig.args ?? []).not.toContain('--resume')
  })
})

describe('provider 隔离边界 + 门控 + 向后兼容', () => {
  test('门控开启时 codex agent 不被注入 claude managed HOME，也不建 claude managed 目录', () => {
    const dataDir = makeTmp('hive-state-')
    const boot = buildAgentRunBootstrap(
      workspace,
      'agent-a',
      { args: [], command: 'codex', commandPresetId: 'codex' },
      sessionStore(),
      presetLookup,
      agent,
      dataDir,
      undefined,
      managedClaudeOptions()
    )

    // codex agent：HOME 不被重定位成 claude managed home，CLAUDE_PROJECTS_ROOT 不设。
    expect(boot.startEnv.HOME).toBeUndefined()
    expect(boot.startEnv.CLAUDE_PROJECTS_ROOT).toBeUndefined()
    // 不建 claude provider 目录（`.../provider/claude`）；codex 那条另起，不算。
    const claudeProviderDir = resolveClaudeManagedHome(dataDir, 'agent-a').replace(/[\\/]home$/, '')
    expect(existsSync(claudeProviderDir)).toBe(false)
  })

  test('门控关闭（默认）时 claude 退回全局 ~/.claude，不重定位 HOME（向后兼容）', () => {
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

    // 门控关：不注入 managed HOME / CLAUDE_PROJECTS_ROOT，不建 claude managed 目录。
    expect(boot.startEnv.HOME).toBeUndefined()
    expect(boot.startEnv.CLAUDE_PROJECTS_ROOT).toBeUndefined()
    expect(existsSync(join(dataDir, 'agents'))).toBe(false)
    // snapshot 仍走全局 projects 根（capture 行为不变）。
    expect(boot.sessionCaptureSnapshot?.root).toBe(claudeProjectsRoot())
  })

  test('无 dataDir 时 claude 退回全局 ~/.claude（向后兼容，即使门控开启）', () => {
    const boot = buildAgentRunBootstrap(
      workspace,
      'agent-a',
      { args: [], command: 'claude', commandPresetId: 'claude' },
      sessionStore(),
      presetLookup,
      agent,
      // 不传 dataDir
      undefined,
      undefined,
      managedClaudeOptions()
    )

    expect(boot.startEnv.HOME).toBeUndefined()
    expect(boot.startEnv.CLAUDE_PROJECTS_ROOT).toBeUndefined()
    expect(boot.sessionCaptureSnapshot?.root).toBe(claudeProjectsRoot())
  })
})
