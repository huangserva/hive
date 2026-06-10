import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { auditCockpitFidelity } from '../../src/server/cockpit-fidelity-audit.js'
import { detectOrphanReports } from '../../src/server/pm-reports-orphan-detector.js'

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

const writeReport = (
  workspace: string,
  filename: string,
  body = '<!doctype html><title>Report</title>'
) => writeFileSync(join(workspace, '.hive', 'reports', filename), body, 'utf8')

const writeResearch = (workspace: string, filename: string, body = '# Research\n') =>
  writeFileSync(join(workspace, '.hive', 'research', filename), body, 'utf8')

const writeNestedResearch = (
  workspace: string,
  relativePath: string,
  body = '# Archived research\n'
) => {
  const path = join(workspace, '.hive', 'research', relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body, 'utf8')
}

describe('auditCockpitFidelity', () => {
  test('does not flag parsed reports that have paired research notes', () => {
    const workspace = setupWorkspace()
    writeReport(
      workspace,
      '2026-05-26-m20-dashboard.html',
      '<!doctype html><title>M20 Dashboard</title>'
    )
    writeResearch(workspace, '2026-05-26-m20-dashboard.md', '# M20 dashboard\n')

    const result = auditCockpitFidelity(workspace)

    expect(result.findings).toEqual([])
    expect(result.checkedAt).toEqual(expect.any(Number))
  })

  test('flags html reports that exist on disk but are absent from parser entries', () => {
    const workspace = setupWorkspace()
    writeReport(workspace, '2026-05-26-parser-gap.HTML', '<!doctype html><title>Parser gap</title>')
    writeResearch(workspace, '2026-05-26-parser-gap.md', '# Parser gap\n')

    const result = auditCockpitFidelity(workspace)

    expect(result.findings).toContainEqual({
      detail: expect.stringContaining('exists in .hive/reports but is absent from parseReportsDoc'),
      file: '2026-05-26-parser-gap.HTML',
      type: 'report_not_parsed',
    })
  })

  test('flags reports without paired research notes', () => {
    const workspace = setupWorkspace()
    writeReport(
      workspace,
      'm20-cross-workspace-dashboard-design-2026-05-26.html',
      '<!doctype html><title>M20 dashboard</title>'
    )

    const result = auditCockpitFidelity(workspace)

    expect(result.findings).toContainEqual({
      detail: expect.stringContaining('missing paired research note'),
      file: 'm20-cross-workspace-dashboard-design-2026-05-26.html',
      type: 'report_missing_research',
    })
  })

  test('uses the same report/research pairing rules as the orphan detector', () => {
    const workspace = setupWorkspace()
    writeReport(
      workspace,
      '2026-06-08-relay-4g-deployment.html',
      '<!doctype html><a href="../research/2026-06-01-relay-mobile-network.md">research</a>'
    )
    writeReport(workspace, '2026-06-08-voice-mockup.html')
    writeReport(workspace, '2026-06-08-session-handoff.html')
    writeReport(
      workspace,
      '2026-06-08-grm-front-layer-orchestration-map.html',
      [
        '<!doctype html>',
        '.hive/research/2026-06-08-grm-front-layer-orchestration-map.md',
        '.hive/research/2026-06-06-voice-intent-front.md',
      ].join('\n')
    )
    writeReport(workspace, '2026-06-08-unpaired-research-spike.html')
    writeResearch(workspace, '2026-06-01-relay-mobile-network.md')
    writeResearch(workspace, '2026-06-08-grm-front-layer-orchestration-map.md')
    writeResearch(workspace, '2026-06-06-voice-intent-front.md')

    const missingResearchFiles = auditCockpitFidelity(workspace)
      .findings.filter((finding) => finding.type === 'report_missing_research')
      .map((finding) => finding.file)

    expect(missingResearchFiles).toEqual(['2026-06-08-unpaired-research-spike.html'])
  })

  test('shares recursive research candidates with the orphan detector', () => {
    const workspace = setupWorkspace()
    writeReport(
      workspace,
      '2026-06-09-archived-research-spike.html',
      '<!doctype html><title>Archived research spike</title>'
    )
    writeNestedResearch(workspace, 'archive/2026-06-09-archived-research-spike.md')

    const missingResearchFiles = auditCockpitFidelity(workspace)
      .findings.filter((finding) => finding.type === 'report_missing_research')
      .map((finding) => finding.file)

    expect(missingResearchFiles).toEqual([])
    expect(detectOrphanReports(join(workspace, '.hive'))).toEqual([])
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
