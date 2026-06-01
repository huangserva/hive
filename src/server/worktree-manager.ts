import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { managedAgentSegment } from './provider-runtime-profile.js'

// M32 Phase 1：worker 独立 CODE worktree + 共享 .hive 治理根。
//
// 设计要点（钟馗 review 后返工 `9874141b`，核心做法改了——见 ADR
// `.hive/decisions/2026-06-01-worker-code-worktree-shared-hive.md`）：
//   1. git worktree add --no-checkout --detach <wt> <baseRef>   （建空壳，detach 避免 branch 污染）
//   2. core.sparseCheckout + info/sparse-checkout `/*` + `!/.hive/` + read-tree -mu HEAD
//      → tracked .hive 被打 skip-worktree（不 materialize 到工作树），其余代码正常 checkout。
//
// **不再在 worktree 里放 `.hive` symlink**（旧做法的 BLOCKER 1）：实测 git 2.39 下，把 symlink 放在
// tracked 的 `.hive` 路径上，`git add -A` 会暂存「A .hive」+「D .hive/plan.md」污染治理边界——
// assume-unchanged / info-exclude 都挡不住 symlink-over-tracked-dir。改为：worker 治理访问**纯靠注入的
// `HIVE_GOVERNANCE_ROOT` env 指向 canonical workspace（其 `.hive` 即权威治理根）**。sparse skip-worktree
// 保证 `git add -A` 对 .hive 完全干净（无 symlink 可暂存、skip-worktree 不暂存删除）。
//
// canonical 主树（orchestrator cwd + .hive governance root）永不被本模块改动。

const GIT_STDIO: ['ignore', 'pipe', 'pipe'] = ['ignore', 'pipe', 'pipe']

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: GIT_STDIO }).trim()

// canonical 路径不是 git 工作树时抛此错。调用方（resolveAgentLaunchRoots）据此区分：
// 「非 git workspace」→ 安全退回旧 cwd 行为；其它任何 ensure 失败 → fail closed（不假装隔离成功）。
export class NotAGitWorkTreeError extends Error {
  constructor(path: string) {
    super(`canonical path is not a git work tree: ${path}`)
    this.name = 'NotAGitWorkTreeError'
  }
}

export interface EnsureWorkerWorktreeInput {
  agentId: string
  baseRef?: string
  canonicalPath: string
  workspaceId: string
  worktreesRoot: string
}

export interface WorkerWorktree {
  codeRoot: string
}

export interface WorktreeManager {
  ensureWorkerWorktree: (input: EnsureWorkerWorktreeInput) => WorkerWorktree
  listWorkerWorktrees: (canonicalPath: string) => string[]
  removeWorkerWorktree: (input: { canonicalPath: string; worktreePath: string }) => void
}

// worktree 物理路径：`${worktreesRoot}/${seg(workspaceId)}/${seg(agentId)}`。
// 两段都经 managedAgentSegment（sanitize + sha256 短前缀）：防 DB 导入 / 自定义 id / 测试注入的
// 路径逃逸（`../`、`/`）与碰撞（两个不同 id 不塌缩到同一 worktree）。
export const resolveWorkerWorktreePath = (
  worktreesRoot: string,
  workspaceId: string,
  agentId: string
): string => join(worktreesRoot, managedAgentSegment(workspaceId), managedAgentSegment(agentId))

const isInsideWorktree = (path: string): boolean => {
  if (!existsSync(path)) return false
  try {
    return git(path, ['rev-parse', '--is-inside-work-tree']) === 'true'
  } catch {
    return false
  }
}

// 该 path 是否是「绑定到本 canonical 的健康 worktree」（幂等复用判定）。
// BLOCKER 4：必须真比对 worktree 的 git-common-dir 与 canonical 的 .git——否则残留 worktree 若
// 绑到别的 / 旧的 canonical（git-common-dir 指向别处），会被当健康复用 → worker 在错的仓库裸跑。
const isHealthyWorktree = (worktreePath: string, canonicalPath: string): boolean => {
  if (!isInsideWorktree(worktreePath)) return false
  try {
    const worktreeCommon = realpathSync(
      resolve(worktreePath, git(worktreePath, ['rev-parse', '--git-common-dir']))
    )
    const canonicalGitDir = realpathSync(git(canonicalPath, ['rev-parse', '--absolute-git-dir']))
    return worktreeCommon === canonicalGitDir
  } catch {
    return false
  }
}

export const createWorktreeManager = (): WorktreeManager => {
  const ensureWorkerWorktree = ({
    agentId,
    baseRef = 'HEAD',
    canonicalPath,
    workspaceId,
    worktreesRoot,
  }: EnsureWorkerWorktreeInput): WorkerWorktree => {
    // canonical 必须是 git repo（否则抛 NotAGitWorkTreeError，调用方据此退回旧 cwd 行为）。
    let insideWorkTree = false
    try {
      insideWorkTree = git(canonicalPath, ['rev-parse', '--is-inside-work-tree']) === 'true'
    } catch {
      insideWorkTree = false
    }
    if (!insideWorkTree) throw new NotAGitWorkTreeError(canonicalPath)

    const worktreePath = resolveWorkerWorktreePath(worktreesRoot, workspaceId, agentId)

    if (isHealthyWorktree(worktreePath, canonicalPath)) {
      return { codeRoot: worktreePath }
    }

    // 残留（半建 / 损坏 / 绑错 canonical）先清掉，保证 ensure 幂等。
    if (existsSync(worktreePath)) {
      try {
        git(canonicalPath, ['worktree', 'remove', '--force', worktreePath])
      } catch {
        rmSync(worktreePath, { force: true, recursive: true })
      }
      try {
        git(canonicalPath, ['worktree', 'prune'])
      } catch {
        // best-effort
      }
    }

    mkdirSync(dirname(worktreePath), { recursive: true })

    // 1. 建空壳 worktree（detach 不建分支，避免多 worker branch 名冲突 / 污染）。
    git(canonicalPath, ['worktree', 'add', '--no-checkout', '--detach', worktreePath, baseRef])

    // 2. sparse-checkout 排除 tracked .hive，再 materialize 其余代码文件。
    //    经典 core.sparseCheckout + 手写 info/sparse-checkout 模式文件 + read-tree -mu（跨 git 版本可靠；
    //    实测 `sparse-checkout set --no-cone` 的负向模式在 2.39 上不 materialize）。`/*` 收全部顶层，
    //    `!/.hive/` 排除 tracked .hive（→ skip-worktree：不落盘、`git diff/add -A` 都不动它）。
    const gitDir = git(worktreePath, ['rev-parse', '--absolute-git-dir'])
    mkdirSync(join(gitDir, 'info'), { recursive: true })
    git(worktreePath, ['config', 'core.sparseCheckout', 'true'])
    writeFileSync(join(gitDir, 'info', 'sparse-checkout'), '/*\n!/.hive/\n')
    git(worktreePath, ['read-tree', '-mu', 'HEAD'])

    // 3. 不放任何 .hive symlink；治理访问走注入的 HIVE_GOVERNANCE_ROOT env（见文件头注释）。
    return { codeRoot: worktreePath }
  }

  const listWorkerWorktrees = (canonicalPath: string): string[] => {
    const out = git(canonicalPath, ['worktree', 'list', '--porcelain'])
    return out
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length))
      .filter((path) => path !== canonicalPath)
  }

  const removeWorkerWorktree = ({
    canonicalPath,
    worktreePath,
  }: {
    canonicalPath: string
    worktreePath: string
  }): void => {
    try {
      git(canonicalPath, ['worktree', 'remove', '--force', worktreePath])
    } catch {
      rmSync(worktreePath, { force: true, recursive: true })
      try {
        git(canonicalPath, ['worktree', 'prune'])
      } catch {
        // best-effort
      }
    }
  }

  return { ensureWorkerWorktree, listWorkerWorktrees, removeWorkerWorktree }
}
