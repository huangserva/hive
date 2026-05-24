import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { detectOrphanReports } from '../../src/server/pm-reports-orphan-detector.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const setupHiveDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-report-orphans-'))
  tempDirs.push(dir)
  const hive = join(dir, '.hive')
  mkdirSync(join(hive, 'reports'), { recursive: true })
  mkdirSync(join(hive, 'research'), { recursive: true })
  return hive
}

const writeReport = (hiveDir: string, filename: string) =>
  writeFileSync(join(hiveDir, 'reports', filename), '<html><body>report</body></html>', 'utf8')

const writeResearch = (hiveDir: string, filename: string) =>
  writeFileSync(join(hiveDir, 'research', filename), '# Research\n', 'utf8')

describe('detectOrphanReports', () => {
  test('allows multiple reports to share one research note with the same date prefix', () => {
    const hive = setupHiveDir()
    writeReport(hive, 'paseo-research-v1-2026-05-24.html')
    writeReport(hive, 'paseo-research-v2-2026-05-24.html')
    writeReport(hive, 'paseo-research-v3-2026-05-24.html')
    writeResearch(hive, '2026-05-24-paseo-research.md')

    expect(detectOrphanReports(hive)).toEqual([])
  })

  test('ignores setup guides, tutorials, and handoff reports', () => {
    const hive = setupHiveDir()
    writeReport(hive, 'feishu-e2e-setup-guide-2026-05-24.html')
    writeReport(hive, '2026-05-24-cli-tutorial.html')
    writeReport(hive, '2026-05-24-session-handoff.html')

    expect(detectOrphanReports(hive)).toEqual([])
  })

  test('reports html files with a date but no same-day research note', () => {
    const hive = setupHiveDir()
    writeReport(hive, '2026-05-24-orphan-spike.html')

    const [orphan] = detectOrphanReports(hive)

    expect(orphan?.reportDate).toBe('2026-05-24')
    expect(basename(orphan?.reportPath ?? '')).toBe('2026-05-24-orphan-spike.html')
    expect(basename(orphan?.suggestedResearchPath ?? '')).toBe('2026-05-24-orphan-spike.md')
  })

  test('detects date infix reports and suggests a date-prefixed research filename', () => {
    const hive = setupHiveDir()
    writeReport(hive, 'external-framework-compare-2026-05-24.html')

    const [orphan] = detectOrphanReports(hive)

    expect(orphan?.reportDate).toBe('2026-05-24')
    expect(basename(orphan?.suggestedResearchPath ?? '')).toBe(
      '2026-05-24-external-framework-compare.md'
    )
  })

  test('pairs reports with nested same-day research notes', () => {
    const hive = setupHiveDir()
    writeReport(hive, '2026-05-24-nested-research.html')
    mkdirSync(join(hive, 'research', 'archive'), { recursive: true })
    writeFileSync(join(hive, 'research', 'archive', '2026-05-24-nested.md'), '# Nested\n', 'utf8')

    expect(detectOrphanReports(hive)).toEqual([])
  })

  test('uses current filesystem state when a previously paired research note is deleted', () => {
    const hive = setupHiveDir()
    writeReport(hive, '2026-05-24-deleted-note.html')
    const researchPath = join(hive, 'research', '2026-05-24-deleted-note.md')
    writeFileSync(researchPath, '# Deleted\n', 'utf8')
    unlinkSync(researchPath)

    const [orphan] = detectOrphanReports(hive)

    expect(orphan?.reportDate).toBe('2026-05-24')
    expect(basename(orphan?.reportPath ?? '')).toBe('2026-05-24-deleted-note.html')
  })
})
