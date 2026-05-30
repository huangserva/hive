import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
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
