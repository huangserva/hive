import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

const loadHook = async () => {
  const mod = await import('../../scripts/pm-governance-precommit.mjs')
  return mod as {
    evaluateStagedPmGovernance: (
      files: string[],
      committedResearchFiles?: string[]
    ) => { errors: string[]; warnings: string[] }
    readCommittedResearchFiles: () => string[]
    readStagedFiles: () => string[]
  }
}

const tempDirs: string[] = []
const originalCwd = process.cwd()

const git = (cwd: string, args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })

afterEach(() => {
  process.chdir(originalCwd)
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

describe('pm governance pre-commit evaluator', () => {
  test('blocks a research-like report html staged without a same-day research note', async () => {
    const { evaluateStagedPmGovernance } = await loadHook()

    const result = evaluateStagedPmGovernance(['.hive/reports/2026-05-24-external-spike.html'])

    expect(result.errors).toContainEqual(expect.stringContaining('2026-05-24-external-spike.html'))
    expect(result.errors).toContainEqual(expect.stringContaining('.hive/research/2026-05-24'))
  })

  test('allows several same-day reports when one research note is staged in the same commit', async () => {
    const { evaluateStagedPmGovernance } = await loadHook()

    const result = evaluateStagedPmGovernance([
      '.hive/reports/paseo-research-2026-05-24.html',
      '.hive/reports/paseo-research-v2-2026-05-24.html',
      '.hive/reports/paseo-multica-hive-compare-2026-05-24.html',
      '.hive/research/2026-05-24-paseo-research.md',
    ])

    expect(result.errors).toEqual([])
  })

  test('allows a staged report when a same-day research note is already committed', async () => {
    const { evaluateStagedPmGovernance } = await loadHook()

    const result = evaluateStagedPmGovernance(
      ['.hive/reports/paseo-multica-hive-compare-2026-05-24.html'],
      ['.hive/research/2026-05-24-paseo-research.md']
    )

    expect(result.errors).toEqual([])
  })

  test('blocks a staged report when committed research notes are only for other dates', async () => {
    const { evaluateStagedPmGovernance } = await loadHook()

    const result = evaluateStagedPmGovernance(
      ['.hive/reports/2026-05-24-orphan-spike.html'],
      ['.hive/research/2026-05-23-older-note.md']
    )

    expect(result.errors).toContainEqual(expect.stringContaining('2026-05-24-orphan-spike.html'))
  })

  test('matches the report date among mixed committed research note dates', async () => {
    const { evaluateStagedPmGovernance } = await loadHook()

    const result = evaluateStagedPmGovernance(
      ['.hive/reports/2026-05-24-framework-compare.html'],
      [
        '.hive/research/2026-05-20-multica-borrowing.md',
        '.hive/research/2026-05-24-paseo-research.md',
        '.hive/research/2026-05-25-future-note.md',
      ]
    )

    expect(result.errors).toEqual([])
  })

  test('does not trust an unstaged working-tree research note', async () => {
    const { evaluateStagedPmGovernance } = await loadHook()

    const result = evaluateStagedPmGovernance(['.hive/reports/2026-05-24-working-tree-only.html'])

    expect(result.errors).toContainEqual(
      expect.stringContaining('2026-05-24-working-tree-only.html')
    )
  })

  test('allows a staged report with a renamed committed research note path for the same date', async () => {
    const { evaluateStagedPmGovernance } = await loadHook()

    const result = evaluateStagedPmGovernance(
      ['.hive/reports/2026-05-24-renamed-note-report.html'],
      ['.hive/research/renamed/2026-05-24-renamed note.md']
    )

    expect(result.errors).toEqual([])
  })

  test('does not count a same-day committed research note staged for deletion', async () => {
    const { evaluateStagedPmGovernance, readCommittedResearchFiles, readStagedFiles } =
      await loadHook()
    const dir = mkdtempSync(join(tmpdir(), 'hive-pm-hook-git-'))
    tempDirs.push(dir)
    const reportPath = join(dir, '.hive', 'reports', '2026-05-24-deleted-note.html')
    const researchPath = join(dir, '.hive', 'research', '2026-05-24-deleted-note.md')
    mkdirSync(join(dir, '.hive', 'reports'), { recursive: true })
    mkdirSync(join(dir, '.hive', 'research'), { recursive: true })
    git(dir, ['init'])
    git(dir, ['config', 'user.email', 'test@example.com'])
    git(dir, ['config', 'user.name', 'Hive Test'])
    writeFileSync(researchPath, '# Research\n', 'utf8')
    git(dir, ['add', '.hive/research/2026-05-24-deleted-note.md'])
    git(dir, ['commit', '-m', 'seed research note'])
    unlinkSync(researchPath)
    writeFileSync(reportPath, '<!doctype html>\n', 'utf8')
    git(dir, ['add', '-A'])
    process.chdir(dir)

    const result = evaluateStagedPmGovernance(readStagedFiles(), readCommittedResearchFiles())

    expect(result.errors).toContainEqual(expect.stringContaining('2026-05-24-deleted-note.html'))
  })

  test('handles spaces in staged report filenames', async () => {
    const { evaluateStagedPmGovernance } = await loadHook()

    const result = evaluateStagedPmGovernance(
      ['.hive/reports/2026-05-24 framework compare.html'],
      ['.hive/research/2026-05-24-framework compare.md']
    )

    expect(result.errors).toEqual([])
  })

  test('ignores guide/tutorial/handoff html reports', async () => {
    const { evaluateStagedPmGovernance } = await loadHook()

    const result = evaluateStagedPmGovernance([
      '.hive/reports/feishu-e2e-setup-guide-2026-05-24.html',
      '.hive/reports/2026-05-24-cli-tutorial.html',
      '.hive/reports/2026-05-24-session-handoff.html',
    ])

    expect(result.errors).toEqual([])
  })

  test('warns when plan.md is staged because milestone edits should cite commit hashes', async () => {
    const { evaluateStagedPmGovernance } = await loadHook()

    const result = evaluateStagedPmGovernance(['.hive/plan.md'])

    expect(result.errors).toEqual([])
    expect(result.warnings).toContainEqual(expect.stringContaining('plan.md'))
    expect(result.warnings).toContainEqual(expect.stringContaining('commit hash'))
  })

  test('git readers degrade to empty lists outside a git repository', async () => {
    const { readCommittedResearchFiles, readStagedFiles } = await loadHook()
    const dir = mkdtempSync(join(tmpdir(), 'hive-pm-hook-no-git-'))
    tempDirs.push(dir)
    process.chdir(dir)

    expect(readCommittedResearchFiles()).toEqual([])
    expect(readStagedFiles()).toEqual([])
  })
})
