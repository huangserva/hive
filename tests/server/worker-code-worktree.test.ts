import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { resolveAgentLaunchRoots } from '../../src/server/agent-launch-roots.js'
import { createWorktreeManager } from '../../src/server/worktree-manager.js'

// M32 Phase 1：真 git 仓库，不 mock PTY/node-pty（§13）。本套测的是「决定 worker cwd + .hive 共享」
// 的承重层（worktree-manager + resolveAgentLaunchRoots）；PTY 把 cwd 透传给 spawn 是 starter 里的
// 一行字面赋值（tsc 保证）。覆盖 dispatch 要求的 5 条：①②③④⑤。

const git = (cwd: string, args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const tempDirs: string[] = []
const mkTemp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

const initCanonicalRepo = () => {
  const canonical = mkTemp('hive-canonical-')
  git(canonical, ['init', '-q', '-b', 'main'])
  git(canonical, ['config', 'user.email', 'test@hive.local'])
  git(canonical, ['config', 'user.name', 'hive-test'])
  git(canonical, ['config', 'commit.gpgsign', 'false'])
  // tracked .hive 治理文件（这是最易被 sparse/symlink 污染的对象）
  mkdirSync(join(canonical, '.hive'), { recursive: true })
  writeFileSync(join(canonical, '.hive', 'plan.md'), 'canonical-plan\n')
  // tracked 代码文件
  writeFileSync(join(canonical, 'src.txt'), 'canonical-code\n')
  git(canonical, ['add', '-A'])
  git(canonical, ['commit', '-q', '-m', 'init'])
  return canonical
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

describe('M32 worktree-manager (real git)', () => {
  let canonical: string
  let worktreesRoot: string

  beforeEach(() => {
    canonical = initCanonicalRepo()
    worktreesRoot = mkTemp('hive-worktrees-')
  })

  // ① worker cwd 真指向独立 worktree
  test('worker worktree is a real, separate git work tree (not the canonical main tree)', () => {
    const manager = createWorktreeManager()
    const { codeRoot } = manager.ensureWorkerWorktree({
      agentId: 'ws:worker-1',
      canonicalPath: canonical,
      workspaceId: 'ws',
      worktreesRoot,
    })
    expect(codeRoot).not.toBe(canonical)
    expect(existsSync(codeRoot)).toBe(true)
    expect(git(codeRoot, ['rev-parse', '--is-inside-work-tree'])).toBe('true')
    // 代码文件被 materialize 到 worker worktree
    expect(existsSync(join(codeRoot, 'src.txt'))).toBe(true)
    expect(readFileSync(join(codeRoot, 'src.txt'), 'utf8')).toBe('canonical-code\n')
  })

  // ② 两 worker 不共享 CODE 工作树 + ensure 幂等
  test('two workers get distinct, independent worktrees; ensure is idempotent', () => {
    const manager = createWorktreeManager()
    const a = manager.ensureWorkerWorktree({
      agentId: 'ws:worker-1',
      canonicalPath: canonical,
      workspaceId: 'ws',
      worktreesRoot,
    })
    const b = manager.ensureWorkerWorktree({
      agentId: 'ws:worker-2',
      canonicalPath: canonical,
      workspaceId: 'ws',
      worktreesRoot,
    })
    expect(a.codeRoot).not.toBe(b.codeRoot)
    // a 写的代码文件对 b 不可见 —— 不互踩
    writeFileSync(join(a.codeRoot, 'only-a.txt'), 'a\n')
    expect(existsSync(join(b.codeRoot, 'only-a.txt'))).toBe(false)
    // 幂等：同一 worker 再 ensure 复用同路径，不破坏已有工作
    const a2 = manager.ensureWorkerWorktree({
      agentId: 'ws:worker-1',
      canonicalPath: canonical,
      workspaceId: 'ws',
      worktreesRoot,
    })
    expect(a2.codeRoot).toBe(a.codeRoot)
    expect(readFileSync(join(a.codeRoot, 'only-a.txt'), 'utf8')).toBe('a\n')
  })

  // ③ worker 看到的 .hive 是 canonical 那份（symlink 生效，双向）
  test('worker .hive is a symlink to canonical governance root (reads + writes hit canonical)', () => {
    const manager = createWorktreeManager()
    const { codeRoot } = manager.ensureWorkerWorktree({
      agentId: 'ws:worker-1',
      canonicalPath: canonical,
      workspaceId: 'ws',
      worktreesRoot,
    })
    const hiveLink = join(codeRoot, '.hive')
    expect(lstatSync(hiveLink).isSymbolicLink()).toBe(true)
    // 读：worker 通过 .hive 看到 canonical 的 plan.md
    expect(readFileSync(join(hiveLink, 'plan.md'), 'utf8')).toBe('canonical-plan\n')
    // 写：worker 往 .hive 写，落到 canonical 主树（治理单一事实源）
    writeFileSync(join(hiveLink, 'note.md'), 'from-worker\n')
    expect(readFileSync(join(canonical, '.hive', 'note.md'), 'utf8')).toBe('from-worker\n')
  })

  // ⑤ sparse-checkout 没把 tracked .hive 留进 worker CODE diff（最易错）
  // 「CODE diff」= PM 审查用的 `git diff HEAD`。承重保证：tracked .hive 绝不以删除/修改形式进
  // worker 的 CODE diff；而 .hive 处的 symlink 是「有意的共享治理入口」，作为未跟踪项存在（不进 diff）。
  test('tracked .hive never appears as a deletion/modification in the worker CODE diff', () => {
    const manager = createWorktreeManager()
    const { codeRoot } = manager.ensureWorkerWorktree({
      agentId: 'ws:worker-1',
      canonicalPath: canonical,
      workspaceId: 'ws',
      worktreesRoot,
    })
    // CODE diff（git diff HEAD）对 .hive 完全干净：没有 tracked .hive 的删除/修改。
    expect(git(codeRoot, ['diff', 'HEAD', '--name-only'])).not.toMatch(/\.hive/)
    // status 里没有 tracked .hive 的「删除/修改」记录（首列/次列为 D 或 M 的 .hive 行）。
    const trackedHiveChange = git(codeRoot, ['status', '--porcelain'])
      .split('\n')
      .filter((line) => /\.hive/.test(line))
      .filter((line) => /^[ ?]?[DM]|^[DM]/.test(line.trimStart()) || /^[ MD][ MD]\s/.test(line))
    // 仅允许「未跟踪的 .hive symlink」（?? .hive），不允许任何 D/M 的 tracked .hive 行。
    expect(trackedHiveChange.filter((line) => !line.startsWith('??'))).toEqual([])

    // 往共享 .hive 写文件后，CODE diff 仍对 .hive 干净（治理写入不污染代码 diff）。
    writeFileSync(join(codeRoot, '.hive', 'scratch.md'), 'x\n')
    expect(git(codeRoot, ['diff', 'HEAD', '--name-only'])).not.toMatch(/\.hive/)

    // 而真正的代码改动照常出现在 diff 里（隔离没把代码也吞掉）。
    writeFileSync(join(codeRoot, 'src.txt'), 'worker-edit\n')
    expect(git(codeRoot, ['diff', 'HEAD', '--name-only'])).toMatch(/src\.txt/)
  })
})

describe('M32 resolveAgentLaunchRoots (backward compat / layering gate)', () => {
  let canonical: string
  let worktreesRoot: string

  beforeEach(() => {
    canonical = initCanonicalRepo()
    worktreesRoot = mkTemp('hive-worktrees-')
  })

  const ws = (path: string, id = 'ws') => ({ id, name: 'demo', path })

  // ④ 无分层配置时退回旧行为
  test('no layering deps → all three roots fall back to workspace.path (old cwd behavior)', () => {
    const roots = resolveAgentLaunchRoots(ws(canonical), 'ws:worker-1')
    expect(roots.cwd).toBe(canonical)
    expect(roots.codeRoot).toBe(canonical)
    expect(roots.workspaceRoot).toBe(canonical)
    expect(roots.governanceRoot).toBe(canonical)
  })

  test('orchestrator stays on the canonical main tree even when layering is enabled', () => {
    const manager = createWorktreeManager()
    const roots = resolveAgentLaunchRoots(ws(canonical), 'ws:orchestrator', {
      ensureWorkerWorktree: manager.ensureWorkerWorktree,
      worktreesRoot,
    })
    expect(roots.cwd).toBe(canonical)
    expect(roots.codeRoot).toBe(canonical)
  })

  test('worker with layering enabled → cwd is its worktree, governance stays canonical', () => {
    const manager = createWorktreeManager()
    const roots = resolveAgentLaunchRoots(ws(canonical), 'ws:worker-1', {
      ensureWorkerWorktree: manager.ensureWorkerWorktree,
      worktreesRoot,
    })
    expect(roots.cwd).not.toBe(canonical)
    expect(roots.codeRoot).toBe(roots.cwd)
    expect(git(roots.codeRoot, ['rev-parse', '--is-inside-work-tree'])).toBe('true')
    // 治理根永远是主树（不跟 worker cwd 走）
    expect(roots.governanceRoot).toBe(canonical)
    expect(roots.workspaceRoot).toBe(canonical)
  })

  test('non-git workspace path → worktree ensure fails → safe fallback to old behavior', () => {
    const manager = createWorktreeManager()
    const nonGit = mkTemp('hive-nongit-')
    const roots = resolveAgentLaunchRoots(ws(nonGit, 'ws2'), 'ws2:worker-1', {
      ensureWorkerWorktree: manager.ensureWorkerWorktree,
      worktreesRoot,
    })
    expect(roots.cwd).toBe(nonGit)
    expect(roots.codeRoot).toBe(nonGit)
  })
})
