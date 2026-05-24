import { describe, expect, test } from 'vitest'

const loadHook = async () => {
  const mod = await import('../../scripts/pm-governance-precommit.mjs')
  return mod as {
    evaluateStagedPmGovernance: (files: string[]) => { errors: string[]; warnings: string[] }
  }
}

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
})
