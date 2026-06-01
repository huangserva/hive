import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

// M32 Phase 1：worker 独立 CODE worktree + 共享 .hive 治理根。
//
// 设计要点（严格按 spike `.hive/reports/2026-06-01-worktree-isolation-spike.html` 的顺序，
// 顺序错会删/污染 tracked .hive）：
//   1. git worktree add --no-checkout --detach <wt> <baseRef>   （建空壳，detach 避免 branch 污染）
//   2. sparse-checkout set --no-cone '/*' '!/.hive/'             （排除 tracked .hive，再 materialize 代码）
//   3. symlink <wt>/.hive -> <canonical>/.hive                  （全队看同一份治理文档）
//   4. 把 /.hive 写进 worktree-private info/exclude             （symlink 不进 worker CODE diff）
//
// canonical 主树（orchestrator cwd + .hive governance root）永不被本模块改动。

const GIT_STDIO: ['ignore', 'pipe', 'pipe'] = ['ignore', 'pipe', 'pipe']

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: GIT_STDIO }).trim()

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

// worktree 物理路径：`${worktreesRoot}/${workspaceId}/${agentId}`，确定性、可重建（Phase 1 不入 DB）。
export const resolveWorkerWorktreePath = (
  worktreesRoot: string,
  workspaceId: string,
  agentId: string
): string => join(worktreesRoot, workspaceId, agentId)

const isInsideWorktree = (path: string): boolean => {
  if (!existsSync(path)) return false
  try {
    return git(path, ['rev-parse', '--is-inside-work-tree']) === 'true'
  } catch {
    return false
  }
}

// 该 path 是否已是「带 .hive symlink 指向 canonical」的健康 worktree（幂等复用判定）。
const isHealthyWorktree = (worktreePath: string, governanceRoot: string): boolean => {
  if (!isInsideWorktree(worktreePath)) return false
  const hiveLink = join(worktreePath, '.hive')
  try {
    const stat = lstatSync(hiveLink)
    if (!stat.isSymbolicLink()) return false
    // realpath 比对：symlink 必须指向 canonical .hive。
    return existsSync(hiveLink) && existsSync(governanceRoot)
  } catch {
    return false
  }
}

const addHiveToWorktreeExclude = (worktreePath: string): void => {
  // worktree 私有 info/exclude（不是 tracked .gitignore），让未跟踪的 .hive symlink 不出现在 status。
  const gitDir = git(worktreePath, ['rev-parse', '--absolute-git-dir'])
  const excludePath = join(gitDir, 'info', 'exclude')
  mkdirSync(dirname(excludePath), { recursive: true })
  const existing = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : ''
  if (existing.split('\n').some((line) => line.trim() === '/.hive')) return
  const next =
    existing.length > 0 && !existing.endsWith('\n')
      ? `${existing}\n/.hive\n`
      : `${existing}/.hive\n`
  writeFileSync(excludePath, next)
}

export const createWorktreeManager = (): WorktreeManager => {
  const ensureWorkerWorktree = ({
    agentId,
    baseRef = 'HEAD',
    canonicalPath,
    workspaceId,
    worktreesRoot,
  }: EnsureWorkerWorktreeInput): WorkerWorktree => {
    // canonical 必须是 git repo（否则抛错，调用方退回旧 cwd 行为）。
    if (git(canonicalPath, ['rev-parse', '--is-inside-work-tree']) !== 'true') {
      throw new Error(`canonical path is not a git work tree: ${canonicalPath}`)
    }
    const governanceRoot = join(canonicalPath, '.hive')
    const worktreePath = resolveWorkerWorktreePath(worktreesRoot, workspaceId, agentId)

    if (isHealthyWorktree(worktreePath, governanceRoot)) {
      return { codeRoot: worktreePath }
    }

    // 残留（半建/损坏）先清掉，保证 ensure 幂等。
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
    //    用经典 core.sparseCheckout + info/sparse-checkout 模式文件 + read-tree -mu —— 比
    //    `sparse-checkout set --no-cone` 的负向模式在跨 git 版本上更可靠（后者在 2.39 上不 materialize）。
    //    模式 `/*` 收全部顶层（目录递归），`!/.hive/` 把 tracked .hive 排除（skip-worktree）。
    const gitDir = git(worktreePath, ['rev-parse', '--absolute-git-dir'])
    mkdirSync(join(gitDir, 'info'), { recursive: true })
    git(worktreePath, ['config', 'core.sparseCheckout', 'true'])
    writeFileSync(join(gitDir, 'info', 'sparse-checkout'), '/*\n!/.hive/\n')
    git(worktreePath, ['read-tree', '-mu', 'HEAD'])

    // 2b. 对 tracked .hive 的每个条目打 assume-unchanged：之后在 .hive 处放 symlink 时，git 不会把
    //     这些「被 symlink 覆盖的 tracked 路径」误报成 worktree-side 删除（symlink-over-tracked-dir
    //     问题）。效果：worker 的 CODE diff（git diff HEAD）对 .hive 完全干净。
    const hiveTracked = git(worktreePath, ['ls-files', '--', '.hive'])
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    for (const tracked of hiveTracked) {
      git(worktreePath, ['update-index', '--assume-unchanged', '--', tracked])
    }

    // 3. .hive symlink 指向 canonical 治理根（此时 .hive 已被 sparse 排除、不在工作树）。
    const hiveLink = join(worktreePath, '.hive')
    if (existsSync(hiveLink) || lstatExists(hiveLink)) {
      rmSync(hiveLink, { force: true, recursive: true })
    }
    symlinkSync(governanceRoot, hiveLink)

    // 4. 让未跟踪的 .hive symlink 不进 worker CODE diff。
    addHiveToWorktreeExclude(worktreePath)

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

const lstatExists = (path: string): boolean => {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}
