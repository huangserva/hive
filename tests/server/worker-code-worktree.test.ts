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
import { join, resolve, sep } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { resolveAgentLaunchRoots } from '../../src/server/agent-launch-roots.js'
import { buildAgentRunBootstrap } from '../../src/server/agent-run-bootstrap.js'
import type { CommandPresetRecord } from '../../src/server/command-preset-store.js'
import {
  createWorktreeManager,
  NotAGitWorkTreeError,
  resolveWorkerWorktreePath,
} from '../../src/server/worktree-manager.js'

// M32 Phase 1（钟馗 review 后返工 9874141b）：真 git 仓库，不 mock PTY/node-pty（§13）。测「决定 worker
// cwd + 治理共享」的承重层（worktree-manager + resolveAgentLaunchRoots）+ session capture cwd 穿透。
// 核心做法已改：worker worktree 不再放 .hive symlink（实测 symlink-over-tracked-.hive 会被 git add -A
// 暂存污染），治理改走注入的 HIVE_GOVERNANCE_ROOT env；sparse skip-worktree 保 `git add -A` 干净。

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
  // tracked .hive 治理文件（最易被 sparse/symlink 污染的对象）+ tracked 代码文件
  mkdirSync(join(canonical, '.hive'), { recursive: true })
  writeFileSync(join(canonical, '.hive', 'plan.md'), 'canonical-plan\n')
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

  // ① worker cwd 真指向独立 worktree（代码 materialize、.hive 被 sparse 排除不落盘）
  test('worker worktree is a real, separate git work tree with code materialized and .hive excluded', () => {
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
    expect(readFileSync(join(codeRoot, 'src.txt'), 'utf8')).toBe('canonical-code\n')
    // .hive 被 sparse skip-worktree 排除：worker 工作树里不落盘（治理走 HIVE_GOVERNANCE_ROOT env）。
    expect(existsSync(join(codeRoot, '.hive'))).toBe(false)
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
    writeFileSync(join(a.codeRoot, 'only-a.txt'), 'a\n')
    expect(existsSync(join(b.codeRoot, 'only-a.txt'))).toBe(false)
    // 幂等：同 worker 再 ensure 复用同路径，不破坏已有工作。
    const a2 = manager.ensureWorkerWorktree({
      agentId: 'ws:worker-1',
      canonicalPath: canonical,
      workspaceId: 'ws',
      worktreesRoot,
    })
    expect(a2.codeRoot).toBe(a.codeRoot)
    expect(readFileSync(join(a.codeRoot, 'only-a.txt'), 'utf8')).toBe('a\n')
  })

  // ③ 治理单一事实源：worktree 里没有 .hive symlink；canonical .hive 不被本模块改动
  test('no .hive symlink is planted in the worktree; canonical .hive is untouched', () => {
    const manager = createWorktreeManager()
    const { codeRoot } = manager.ensureWorkerWorktree({
      agentId: 'ws:worker-1',
      canonicalPath: canonical,
      workspaceId: 'ws',
      worktreesRoot,
    })
    // 不存在任何 .hive（symlink 或目录）——这是 BLOCKER 1 的根治：不在 tracked 路径上放 symlink。
    expect(existsSync(join(codeRoot, '.hive'))).toBe(false)
    let isLink = false
    try {
      isLink = lstatSync(join(codeRoot, '.hive')).isSymbolicLink()
    } catch {
      isLink = false
    }
    expect(isLink).toBe(false)
    // canonical 治理根原样（权威源不被污染）。
    expect(readFileSync(join(canonical, '.hive', 'plan.md'), 'utf8')).toBe('canonical-plan\n')
  })

  // ④【BLOCKER 1 回归】worker 在 worktree 跑 git add -A，staged diff 不得含 .hive
  test('git add -A in the worker worktree never stages tracked .hive (no A/D .hive pollution)', () => {
    const manager = createWorktreeManager()
    const { codeRoot } = manager.ensureWorkerWorktree({
      agentId: 'ws:worker-1',
      canonicalPath: canonical,
      workspaceId: 'ws',
      worktreesRoot,
    })
    // 改真实代码 + 全量暂存（worker 常见动作）。
    writeFileSync(join(codeRoot, 'src.txt'), 'worker-edit\n')
    git(codeRoot, ['add', '-A'])
    const staged = git(codeRoot, ['diff', '--cached', '--name-status', 'HEAD'])
    // 断言：暂存区相对 HEAD 完全不含 .hive（旧实现会出 `A .hive` + `D .hive/plan.md`）。
    expect(staged).not.toMatch(/\.hive/)
    // 而真实代码改动照常进暂存（隔离没把代码也吞掉）。
    expect(staged).toMatch(/src\.txt/)
  })

  // ⑤【BLOCKER 4 回归】健康检查真比对 git-common-dir：绑到别的 canonical 的残留 worktree 不得复用
  test('a residual worktree bound to a DIFFERENT canonical is detected unhealthy and rebuilt', () => {
    const manager = createWorktreeManager()
    const wtPath = resolveWorkerWorktreePath(worktreesRoot, 'ws', 'ws:worker-1')

    // 先用「别的 canonical」在该路径建一个 worktree（模拟旧 workspace / 串治理的坏残留）。
    const otherCanonical = initCanonicalRepo()
    mkdirSync(join(wtPath, '..'), { recursive: true })
    git(otherCanonical, ['worktree', 'add', '--detach', wtPath, 'HEAD'])
    // 残留此刻绑的是 otherCanonical（git-common-dir 指向别处）。
    expect(git(wtPath, ['rev-parse', '--git-common-dir'])).toBe(
      git(otherCanonical, ['rev-parse', '--absolute-git-dir'])
    )

    // ensure 用本 canonical：必须识别出残留绑错了 canonical → 清掉重建，绑到本 canonical。
    const { codeRoot } = manager.ensureWorkerWorktree({
      agentId: 'ws:worker-1',
      canonicalPath: canonical,
      workspaceId: 'ws',
      worktreesRoot,
    })
    expect(codeRoot).toBe(wtPath)
    const reboundCommon = git(codeRoot, ['rev-parse', '--git-common-dir'])
    expect(reboundCommon).toBe(git(canonical, ['rev-parse', '--absolute-git-dir']))
  })

  // 【MEDIUM 1】路径 segment sanitize：恶意 id 不得逃逸 worktreesRoot
  test('worktree path segments are sanitized/hashed (no path escape, no collision)', () => {
    const escaping = resolveWorkerWorktreePath(worktreesRoot, 'ws', '../../etc/passwd')
    // `/` 被压成 `_`，`..` 沦为惰性字符（无 `/../` 目录穿越）→ normalize 后仍稳稳在 worktreesRoot 内。
    expect(resolve(escaping).startsWith(resolve(worktreesRoot) + sep)).toBe(true)
    expect(escaping).not.toContain(`..${sep}`)
    // worktreesRoot 之后只剩两段（workspace seg / agent seg），没有多余路径分隔符可穿越。
    expect(escaping.slice(worktreesRoot.length + 1).split(sep)).toHaveLength(2)
    // 不同 id 不塌缩到同一路径。
    expect(resolveWorkerWorktreePath(worktreesRoot, 'ws', 'a')).not.toBe(
      resolveWorkerWorktreePath(worktreesRoot, 'ws', 'b')
    )
  })
})

describe('M32 resolveAgentLaunchRoots (backward compat / layering gate / fail-closed)', () => {
  let canonical: string
  let worktreesRoot: string

  beforeEach(() => {
    canonical = initCanonicalRepo()
    worktreesRoot = mkTemp('hive-worktrees-')
  })

  const ws = (path: string, id = 'ws') => ({ id, name: 'demo', path })

  // ⑥ 无分层配置时退回旧行为
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
    // 治理根永远是主树（不跟 worker cwd 走）。
    expect(roots.governanceRoot).toBe(canonical)
    expect(roots.workspaceRoot).toBe(canonical)
  })

  // ⑦ 非 git workspace → ensure 抛 NotAGitWorkTreeError → 安全退回旧行为
  test('non-git workspace → NotAGitWorkTreeError → safe fallback to old behavior', () => {
    const manager = createWorktreeManager()
    const nonGit = mkTemp('hive-nongit-')
    const roots = resolveAgentLaunchRoots(ws(nonGit, 'ws2'), 'ws2:worker-1', {
      ensureWorkerWorktree: manager.ensureWorkerWorktree,
      worktreesRoot,
    })
    expect(roots.cwd).toBe(nonGit)
    expect(roots.codeRoot).toBe(nonGit)
  })

  // ⑧【BLOCKER 3】git repo + 隔离开启，但 ensure 因「非 non-git」原因失败 → fail closed（不静默退回主树）
  test('git repo + ensure fails for a non-non-git reason → throws (fail closed, does NOT return canonical)', () => {
    const boom = () => {
      throw new Error('worktree add failed: disk full / permission / corrupt residual')
    }
    expect(() =>
      resolveAgentLaunchRoots(ws(canonical), 'ws:worker-1', {
        ensureWorkerWorktree: boom,
        worktreesRoot,
      })
    ).toThrow(/worktree add failed/)
  })

  test('NotAGitWorkTreeError is the ONLY error that triggers fallback', () => {
    const notGit = () => {
      throw new NotAGitWorkTreeError('/not/a/repo')
    }
    const roots = resolveAgentLaunchRoots(ws(canonical), 'ws:worker-1', {
      ensureWorkerWorktree: notGit,
      worktreesRoot,
    })
    expect(roots.cwd).toBe(canonical)
  })
})

describe('M32 BLOCKER 2 — session capture/resume uses the worker real cwd (codeRoot)', () => {
  let savedHome: string | undefined
  let fakeHome: string

  beforeEach(() => {
    savedHome = process.env.HOME
    fakeHome = mkTemp('hive-fakehome-')
    process.env.HOME = fakeHome
  })
  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME
    else process.env.HOME = savedHome
  })

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
  const presetLookup = (id: string) => (id === 'claude' ? claudePreset : undefined)
  const store = () => ({
    clearLastSessionId: () => {},
    getLastSessionId: () => undefined,
    setLastSessionId: () => {},
  })
  const encodeCwd = (cwd: string) => cwd.replace(/[\\/:\s]/g, '-')

  test('snapshot scans the codeRoot project dir, not workspace.path', () => {
    const canonical = initCanonicalRepo()
    const worktreesRoot = mkTemp('hive-worktrees-')
    const manager = createWorktreeManager()
    const { codeRoot } = manager.ensureWorkerWorktree({
      agentId: 'ws:worker-1',
      canonicalPath: canonical,
      workspaceId: 'ws',
      worktreesRoot,
    })
    const workspace = { id: 'ws', name: 'demo', path: canonical }
    const agent = { id: 'ws:worker-1', name: '关羽', role: 'coder', status: 'idle' as const }
    const globalProjects = join(fakeHome, '.claude', 'projects')
    const SID = '11111111-1111-4111-8111-111111111111'
    const DECOY = '22222222-2222-4222-9222-222222222222'
    // 真实 cwd（codeRoot）下有一份会话；旧 cwd（workspace.path）下放诱饵。
    mkdirSync(join(globalProjects, encodeCwd(codeRoot)), { recursive: true })
    writeFileSync(join(globalProjects, encodeCwd(codeRoot), `${SID}.jsonl`), '{}\n', 'utf8')
    mkdirSync(join(globalProjects, encodeCwd(canonical)), { recursive: true })
    writeFileSync(join(globalProjects, encodeCwd(canonical), `${DECOY}.jsonl`), '{}\n', 'utf8')

    // 传 launchCwd=codeRoot（starter 在 M32 开启时就这么传）。
    const boot = buildAgentRunBootstrap(
      workspace,
      'ws:worker-1',
      { args: [], command: 'claude', commandPresetId: 'claude' },
      store(),
      presetLookup,
      agent,
      undefined,
      codeRoot
    )
    const seen = boot.sessionCaptureSnapshot?.knownSessionIds
    expect(seen?.has(SID)).toBe(true)
    // 决定性：诱饵（workspace.path 下）不被看到 → 证明扫的是 codeRoot 不是 workspace.path。
    expect(seen?.has(DECOY)).toBe(false)
  })

  test('without launchCwd (unlayered) snapshot falls back to workspace.path (backward compat)', () => {
    const canonical = initCanonicalRepo()
    const workspace = { id: 'ws', name: 'demo', path: canonical }
    const agent = { id: 'ws:worker-1', name: '关羽', role: 'coder', status: 'idle' as const }
    const globalProjects = join(fakeHome, '.claude', 'projects')
    const SID = '33333333-3333-4333-8333-333333333333'
    mkdirSync(join(globalProjects, encodeCwd(canonical)), { recursive: true })
    writeFileSync(join(globalProjects, encodeCwd(canonical), `${SID}.jsonl`), '{}\n', 'utf8')

    const boot = buildAgentRunBootstrap(
      workspace,
      'ws:worker-1',
      { args: [], command: 'claude', commandPresetId: 'claude' },
      store(),
      presetLookup,
      agent
      // 不传 dataDir / launchCwd → 退回 workspace.path
    )
    expect(boot.sessionCaptureSnapshot?.knownSessionIds?.has(SID)).toBe(true)
  })
})
