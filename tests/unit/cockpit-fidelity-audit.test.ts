import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { auditCockpitFidelity } from '../../src/server/cockpit-fidelity-audit.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const setupWorkspace = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-cockpit-fidelity-'))
  tempDirs.push(dir)
  mkdirSync(join(dir, '.hive', 'reports'), { recursive: true })
  mkdirSync(join(dir, '.hive', 'research'), { recursive: true })
  mkdirSync(join(dir, '.hive', 'decisions'), { recursive: true })
  return dir
}

describe('auditCockpitFidelity', () => {
  test('does not flag parsed reports that have paired research notes', () => {
    const workspace = setupWorkspace()
    writeFileSync(
      join(workspace, '.hive', 'reports', '2026-05-26-m20-dashboard.html'),
      '<!doctype html><title>M20 Dashboard</title>',
      'utf8'
    )
    writeFileSync(
      join(workspace, '.hive', 'research', '2026-05-26-m20-dashboard.md'),
      '# M20 dashboard\n',
      'utf8'
    )

    const result = auditCockpitFidelity(workspace)

    expect(result.findings).toEqual([])
    expect(result.checkedAt).toEqual(expect.any(Number))
  })

  test('flags html reports that exist on disk but are absent from parser entries', () => {
    const workspace = setupWorkspace()
    writeFileSync(
      join(workspace, '.hive', 'reports', '2026-05-26-parser-gap.HTML'),
      '<!doctype html><title>Parser gap</title>',
      'utf8'
    )
    writeFileSync(
      join(workspace, '.hive', 'research', '2026-05-26-parser-gap.md'),
      '# Parser gap\n',
      'utf8'
    )

    const result = auditCockpitFidelity(workspace)

    expect(result.findings).toContainEqual({
      detail: expect.stringContaining('exists in .hive/reports but is absent from parseReportsDoc'),
      file: '2026-05-26-parser-gap.HTML',
      type: 'report_not_parsed',
    })
  })

  test('flags reports without paired research notes', () => {
    const workspace = setupWorkspace()
    writeFileSync(
      join(workspace, '.hive', 'reports', 'm20-cross-workspace-dashboard-design-2026-05-26.html'),
      '<!doctype html><title>M20 dashboard</title>',
      'utf8'
    )

    const result = auditCockpitFidelity(workspace)

    expect(result.findings).toContainEqual({
      detail: expect.stringContaining('missing paired research note'),
      file: 'm20-cross-workspace-dashboard-design-2026-05-26.html',
      type: 'report_missing_research',
    })
  })

  test('does not flag decisions with inline status or date metadata', () => {
    const workspace = setupWorkspace()
    writeFileSync(
      join(workspace, '.hive', 'decisions', '2026-05-26-ui-quality-standard.md'),
      '# 决策：UI quality standard\n\n**状态**: 已采纳\n**日期**: 2026-05-26\n',
      'utf8'
    )

    const result = auditCockpitFidelity(workspace)

    expect(result.findings.filter((finding) => finding.file.endsWith('.md'))).toEqual([])
  })

  test('flags decision files that exist on disk but are absent from parser entries', () => {
    const workspace = setupWorkspace()
    writeFileSync(
      join(workspace, '.hive', 'decisions', '2026-05-26-parser-gap.MD'),
      '# 决策：parser gap\n\n**状态**: 已采纳\n',
      'utf8'
    )

    const result = auditCockpitFidelity(workspace)

    expect(result.findings).toContainEqual({
      detail: expect.stringContaining(
        'exists in .hive/decisions but is absent from parseDecisionsDoc'
      ),
      file: '2026-05-26-parser-gap.MD',
      type: 'decision_not_parsed',
    })
  })

  test('flags YAML-only decision metadata as a cockpit format warning', () => {
    const workspace = setupWorkspace()
    writeFileSync(
      join(workspace, '.hive', 'decisions', '2026-05-26-ui-quality-standard.md'),
      '---\nstatus: adopted\ndate: 2026-05-26\n---\n# UI quality standard\n',
      'utf8'
    )

    const result = auditCockpitFidelity(workspace)

    expect(result.findings).toContainEqual({
      detail: expect.stringContaining('YAML frontmatter'),
      file: '2026-05-26-ui-quality-standard.md',
      type: 'decision_format_warning',
    })
  })
})
