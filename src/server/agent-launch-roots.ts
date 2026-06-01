import type { WorkspaceSummary } from '../shared/types.js'
import type { EnsureWorkerWorktreeInput, WorkerWorktree } from './worktree-manager.js'

// M32 Phase 1：把 workspace 单一 path 在「启动时」分层成三个根，注入 PTY cwd + env。
//   - workspaceRoot  = canonical 主树（= 现有 workspace.path）
//   - governanceRoot = canonical/.hive 所在主树（治理单一事实源，永远主树）
//   - codeRoot       = orchestrator 用主树；worker 用各自独立 CODE worktree
//
// 向后兼容：未开启分层（无 worktreesRoot/ensure）、orchestrator、或 git 失败 → 三根全部退回
// workspace.path，cwd 即旧行为 `cwd: workspace.path`。

export interface AgentLaunchRoots {
  codeRoot: string
  cwd: string
  governanceRoot: string
  workspaceRoot: string
}

export interface ResolveAgentLaunchRootsDeps {
  // 仅当显式开启 worker 分层时提供（HIVE_WORKER_WORKTREES）；缺省即旧行为。
  ensureWorkerWorktree?: (input: EnsureWorkerWorktreeInput) => WorkerWorktree
  worktreesRoot?: string
  // 测试可注入；默认按 `${id}:orchestrator` 约定判定。
  isOrchestratorAgent?: (agentId: string) => boolean
}

const defaultIsOrchestrator = (agentId: string) => agentId.endsWith(':orchestrator')

export const resolveAgentLaunchRoots = (
  workspace: WorkspaceSummary,
  agentId: string,
  deps: ResolveAgentLaunchRootsDeps = {}
): AgentLaunchRoots => {
  const workspaceRoot = workspace.path
  const governanceRoot = workspace.path
  const isOrchestrator = (deps.isOrchestratorAgent ?? defaultIsOrchestrator)(agentId)

  const fallback: AgentLaunchRoots = {
    codeRoot: workspaceRoot,
    cwd: workspaceRoot,
    governanceRoot,
    workspaceRoot,
  }

  // 分层未开启 / orchestrator → 主树（旧行为）。
  if (isOrchestrator || !deps.worktreesRoot || !deps.ensureWorkerWorktree) {
    return fallback
  }

  try {
    const { codeRoot } = deps.ensureWorkerWorktree({
      agentId,
      canonicalPath: workspace.path,
      workspaceId: workspace.id,
      worktreesRoot: deps.worktreesRoot,
    })
    return { codeRoot, cwd: codeRoot, governanceRoot, workspaceRoot }
  } catch {
    // canonical 非 git repo / worktree 建失败 → 安全退回旧行为，绝不阻塞 worker 启动。
    return fallback
  }
}
