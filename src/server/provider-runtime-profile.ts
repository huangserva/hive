import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// M25 Phase 1：Codex provider managed home + session 隔离。
//
// 问题：所有 codex worker 此前共享全局 `~/.codex` session 目录，靠 session 文件内容里的
// discriminator marker 区分归属 → 反复出 session 串线 / 抓串 id / resume 错绑。
// 根治：给每个 agent 一个**物理隔离**的 managed CODEX_HOME（含独立 sessions 根），
// codex 进程读写都被关在自己的 home 里，不再有跨 agent 抢 session 的可能。
//
// 经 CCB（claude_codex_bridge）契约验证的硬约束：
// - 只设 CODEX_SESSION_ROOT 不足以隔离 codex 会话日志，**必须**设独立 CODEX_HOME；
// - 有效 session 根恒为 `<CODEX_HOME>/sessions`，是 home 派生态而非独立 authority。
// 本 Phase 只做 Codex；Claude/Gemini/OpenCode 留给后续 milestone（接口见文件尾注）。

const CODEX_CAPTURE_SOURCE = 'codex_session_jsonl_dir'

export const isCodexCaptureSource = (source: string | undefined): boolean =>
  source === CODEX_CAPTURE_SOURCE

// agentId 可能含 ':'（如 `<workspace>:orchestrator`）等文件名不安全字符。
// 取 sanitized 主体 + agentId 的 sha256 前缀拼成目录段：既可读，又用 hash 保证
// 两个不同 agentId 不会塌缩到同一个 managed home（呼应 CCB 的 runtime-home 唯一性校验）。
export const managedAgentSegment = (agentId: string): string => {
  const sanitized = agentId.replace(/[^A-Za-z0-9._-]/g, '_') || 'agent'
  const digest = createHash('sha256').update(agentId).digest('hex').slice(0, 8)
  return `${sanitized}-${digest}`
}

// managed Codex home 布局：`<dataDir>/agents/<agentSeg>/provider/codex/home`
export const resolveCodexManagedHome = (dataDir: string, agentId: string): string =>
  join(dataDir, 'agents', managedAgentSegment(agentId), 'provider', 'codex', 'home')

// 有效 session 根恒为 `<home>/sessions`（契约硬约束，不可另立）。
export const resolveCodexSessionRoot = (managedHome: string): string =>
  join(managedHome, 'sessions')

// 投影来源：user 真实的 `~/.codex`（凭据 + config 的权威源）。
export const defaultCodexSourceHome = (): string => join(homedir(), '.codex')

export interface CodexManagedProfile {
  // 注入给 codex 进程的 env：CODEX_HOME 是隔离边界，CODEX_SESSION_ROOT 显式钉死派生根。
  env: { CODEX_HOME: string; CODEX_SESSION_ROOT: string }
  home: string
  sessionRoot: string
}

// 把"够用"的 managed codex home 物化出来：
// 1. 建 home + `sessions/`（启动前必须存在）。
// 2. 投影 config.toml：有 source 就拷（让 managed codex 沿用同样的模型 / MCP 配置），
//    无 source 且 target 也没有时写一个空 stub。
// 3. 投影 auth.json：有 source 就拷（managed home 否则无凭据、codex 起不来）。auth 是 secret，
//    只在私有 managed home 内投影，**绝不可被 diagnostics / support bundle 导出**。
// 每次启动都刷新 config/auth（幂等），让 source 改 key / 换模型后重启即可见。
// CCB 还做 memory(AGENTS.md) / plugins / skills / commands / activity-hooks 投影，
// Phase 1 不做——会话隔离不依赖它们，留给后续 phase。
export const materializeCodexManagedHome = (options: {
  managedHome: string
  sourceHome?: string
}): CodexManagedProfile => {
  const { managedHome } = options
  const sourceHome = options.sourceHome ?? defaultCodexSourceHome()
  const sessionRoot = resolveCodexSessionRoot(managedHome)
  mkdirSync(sessionRoot, { recursive: true })

  const sourceConfig = join(sourceHome, 'config.toml')
  const targetConfig = join(managedHome, 'config.toml')
  if (existsSync(sourceConfig)) {
    copyFileSync(sourceConfig, targetConfig)
  } else if (!existsSync(targetConfig)) {
    writeFileSync(targetConfig, '# hive-managed codex home (agent-local)\n', 'utf8')
  }

  const sourceAuth = join(sourceHome, 'auth.json')
  if (existsSync(sourceAuth)) {
    copyFileSync(sourceAuth, join(managedHome, 'auth.json'))
  }

  return {
    env: { CODEX_HOME: managedHome, CODEX_SESSION_ROOT: sessionRoot },
    home: managedHome,
    sessionRoot,
  }
}

// 便捷封装：从 dataDir + agentId 解析 managed home 并物化，返回可直接注入的 profile。
export const materializeCodexManagedProfile = (
  dataDir: string,
  agentId: string,
  sourceHome?: string
): CodexManagedProfile =>
  materializeCodexManagedHome({
    managedHome: resolveCodexManagedHome(dataDir, agentId),
    ...(sourceHome ? { sourceHome } : {}),
  })

// ============================================================================
// M25 Phase 2：Claude provider managed home + session 隔离。
//
// 沿用 Codex Phase 1 的形态（per-agent 物理隔离 home + 投影 auth/config + 钉死 session 根），
// 但 Claude 的隔离边界与 Codex 不同（经 CCB `docs/claude-session-isolation-contract.md` 契约确认）：
// - Claude Code **没有** 稳定的 `CLAUDE_HOME` flag → 隔离**必须**靠重定位私有 `HOME`；
// - **只设 `CLAUDE_PROJECTS_ROOT` 不足以**隔离，因为 Claude 还读 HOME 下的其它状态（凭据/账户元数据）；
// - 有效 projects 根恒为 `<HOME>/.claude/projects`，session-env 根恒为 `<HOME>/.claude/session-env`
//   （是 HOME 派生态，不是独立 authority）。
// - macOS 上官方登录密钥在 Keychain（非 source-home 文件）→ 重定位 HOME 后需把 Keychain 兼容态
//   投影/链接进 managed home，否则 claude 起不来。这条让"重定位 HOME"在 darwin 上鉴权风险偏高，
//   因此本 Phase 默认关闭（HIVE_CLAUDE_MANAGED_HOME=1 显式开启），待真机验证后再默认开。
//
// 与 M32 worker CODE worktree（cwd 维）解耦：本维只决定 HOME + CLAUDE_PROJECTS_ROOT，不碰 cwd；
// 两者各自用传入的 cwd/agentId，可叠加。本 Phase 取"够用"子集（projects/session-env 根 + settings/
// credentials/.claude.json 投影 + macOS Keychain 兼容），memory/skills/commands/fingerprint 留后续。

const CLAUDE_CAPTURE_SOURCE = 'claude_project_jsonl_dir'

export const isClaudeCaptureSource = (source: string | undefined): boolean =>
  source === CLAUDE_CAPTURE_SOURCE

// 门控：Claude managed home 默认关闭。重定位 HOME 在 macOS 触及 Keychain 鉴权，需真机验证后才默认开。
export const isClaudeManagedHomeEnabled = (): boolean =>
  process.env.HIVE_CLAUDE_MANAGED_HOME === '1'

// managed Claude home 布局：`<dataDir>/agents/<agentSeg>/provider/claude/home`（与 codex 平行）。
export const resolveClaudeManagedHome = (dataDir: string, agentId: string): string =>
  join(dataDir, 'agents', managedAgentSegment(agentId), 'provider', 'claude', 'home')

// 契约硬约束：CLAUDE_PROJECTS_ROOT 恒为 `<home>/.claude/projects`，不可另立。
export const resolveClaudeProjectsRoot = (managedHome: string): string =>
  join(managedHome, '.claude', 'projects')

// session-env 根恒为 `<home>/.claude/session-env`（HOME 派生态）。
export const resolveClaudeSessionEnvRoot = (managedHome: string): string =>
  join(managedHome, '.claude', 'session-env')

// 投影来源：user 真实 HOME（凭据 / 账户元数据 / settings 的权威源）。注意 `.claude.json` 在 HOME 根，
// settings.json / .credentials.json 在 `<HOME>/.claude/`。Node `os.homedir()` 在 POSIX 上取 $HOME，
// 测试可通过设 process.env.HOME 控制 source（不污染真实用户目录）。
export const defaultClaudeSourceHome = (): string => homedir()

export interface ClaudeManagedProfile {
  // 注入给 claude 进程的 env：HOME 是隔离边界，CLAUDE_PROJECTS_ROOT 显式钉死派生根。
  env: { CLAUDE_PROJECTS_ROOT: string; HOME: string }
  home: string
  projectsRoot: string
  sessionEnvRoot: string
}

// 把"够用"的 managed Claude home 物化出来：
// 1. 建 home + `.claude/projects/` + `.claude/session-env/`（启动前必须存在）。
// 2. 投影 settings.json / .credentials.json（`<src>/.claude/` 下）+ .claude.json（`<src>` 根下）：
//    凭据/账户元数据是 secret，只在私有 managed home 内投影，**绝不可被 diagnostics 导出**。
// 3. macOS Keychain 兼容（重定位 HOME 后官方登录密钥仍可达）：有 com.apple.security.plist 就拷；
//    否则 symlink managed `Library/Keychains` → 用户 `~/Library/Keychains`（best-effort，失败不致命）。
// 每次启动刷新投影（幂等），让 source 改 key / 重登后重启可见。
export const materializeClaudeManagedHome = (options: {
  managedHome: string
  sourceHome?: string
}): ClaudeManagedProfile => {
  const { managedHome } = options
  const sourceHome = options.sourceHome ?? defaultClaudeSourceHome()
  const projectsRoot = resolveClaudeProjectsRoot(managedHome)
  const sessionEnvRoot = resolveClaudeSessionEnvRoot(managedHome)
  mkdirSync(projectsRoot, { recursive: true })
  mkdirSync(sessionEnvRoot, { recursive: true })

  // settings.json / .credentials.json：source 在 `<HOME>/.claude/` 下。
  const projectClaudeFile = (name: string) => {
    const src = join(sourceHome, '.claude', name)
    if (existsSync(src)) copyFileSync(src, join(managedHome, '.claude', name))
  }
  projectClaudeFile('settings.json')
  projectClaudeFile('.credentials.json')

  // .claude.json（账户元数据 / 工作区信任）在 HOME 根。
  const sourceClaudeJson = join(sourceHome, '.claude.json')
  if (existsSync(sourceClaudeJson))
    copyFileSync(sourceClaudeJson, join(managedHome, '.claude.json'))

  // macOS Keychain 兼容态（仅 darwin，best-effort，不让平台差异打断启动）。
  if (process.platform === 'darwin') {
    try {
      const sourcePlist = join(sourceHome, 'Library', 'Preferences', 'com.apple.security.plist')
      if (existsSync(sourcePlist)) {
        const targetPrefs = join(managedHome, 'Library', 'Preferences')
        mkdirSync(targetPrefs, { recursive: true })
        copyFileSync(sourcePlist, join(targetPrefs, 'com.apple.security.plist'))
      } else {
        const sourceKeychains = join(sourceHome, 'Library', 'Keychains')
        const targetLibrary = join(managedHome, 'Library')
        const targetKeychains = join(targetLibrary, 'Keychains')
        if (existsSync(sourceKeychains) && !existsSync(targetKeychains)) {
          mkdirSync(targetLibrary, { recursive: true })
          symlinkSync(sourceKeychains, targetKeychains)
        }
      }
    } catch {
      // best-effort：Keychain 兼容失败不阻断启动（真机验证阶段再补强）。
    }
  }

  return {
    env: { CLAUDE_PROJECTS_ROOT: projectsRoot, HOME: managedHome },
    home: managedHome,
    projectsRoot,
    sessionEnvRoot,
  }
}

// 便捷封装：从 dataDir + agentId 解析 managed Claude home 并物化，返回可直接注入的 profile。
export const materializeClaudeManagedProfile = (
  dataDir: string,
  agentId: string,
  sourceHome?: string
): ClaudeManagedProfile =>
  materializeClaudeManagedHome({
    managedHome: resolveClaudeManagedHome(dataDir, agentId),
    ...(sourceHome ? { sourceHome } : {}),
  })
