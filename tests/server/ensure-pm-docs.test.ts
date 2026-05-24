import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { ensurePmDocs } from '../../src/server/tasks-file.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

describe('ensurePmDocs', () => {
  test('creates plan.md and all template files in empty workspace', () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-pm-empty-'))
    tempDirs.push(workspacePath)

    ensurePmDocs(workspacePath)

    expect(existsSync(join(workspacePath, '.hive', 'plan.md'))).toBe(true)
    expect(existsSync(join(workspacePath, '.hive', 'templates', 'plan.template.md'))).toBe(true)
    expect(existsSync(join(workspacePath, '.hive', 'templates', 'adr.template.md'))).toBe(true)
    expect(existsSync(join(workspacePath, '.hive', 'templates', 'handoff.template.html'))).toBe(
      true
    )
    expect(existsSync(join(workspacePath, '.hive', 'templates', 'research.template.md'))).toBe(true)
    expect(
      existsSync(join(workspacePath, '.hive', 'templates', 'milestone-review.template.md'))
    ).toBe(true)
  })

  test('does not overwrite existing plan.md', () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-pm-exist-'))
    tempDirs.push(workspacePath)

    ensurePmDocs(workspacePath)
    const userContent = '# My Custom Plan\nUser edits here'
    writeFileSync(join(workspacePath, '.hive', 'plan.md'), userContent, 'utf8')

    ensurePmDocs(workspacePath)

    const content = readFileSync(join(workspacePath, '.hive', 'plan.md'), 'utf8')
    expect(content).toBe(userContent)
  })

  test('does not overwrite existing template file', () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-pm-template-'))
    tempDirs.push(workspacePath)

    ensurePmDocs(workspacePath)
    const customTemplate = '# Custom ADR Template'
    writeFileSync(
      join(workspacePath, '.hive', 'templates', 'adr.template.md'),
      customTemplate,
      'utf8'
    )

    ensurePmDocs(workspacePath)

    const content = readFileSync(
      join(workspacePath, '.hive', 'templates', 'adr.template.md'),
      'utf8'
    )
    expect(content).toBe(customTemplate)
  })

  test('plan.md replaces {{PROJECT_NAME}} with workspace basename', () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'my-project-'))
    tempDirs.push(workspacePath)

    ensurePmDocs(workspacePath)

    const content = readFileSync(join(workspacePath, '.hive', 'plan.md'), 'utf8')
    expect(content).not.toContain('{{PROJECT_NAME}}')
    expect(content).toContain('my-project-')
  })

  test('plan.md replaces {{YYYY-MM-DD}} with ISO date', () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-pm-date-'))
    tempDirs.push(workspacePath)

    ensurePmDocs(workspacePath)

    const content = readFileSync(join(workspacePath, '.hive', 'plan.md'), 'utf8')
    expect(content).not.toContain('{{YYYY-MM-DD}}')
    const isoDatePattern = /\d{4}-\d{2}-\d{2}/
    expect(isoDatePattern.test(content)).toBe(true)
  })

  test('multiple calls are idempotent', () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-pm-idem-'))
    tempDirs.push(workspacePath)

    ensurePmDocs(workspacePath)
    const firstContent = readFileSync(join(workspacePath, '.hive', 'plan.md'), 'utf8')

    ensurePmDocs(workspacePath)
    const secondContent = readFileSync(join(workspacePath, '.hive', 'plan.md'), 'utf8')

    expect(firstContent).toBe(secondContent)
  })

  test('creates all 14 new PM files in empty workspace', () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-pm-new-'))
    tempDirs.push(workspacePath)

    ensurePmDocs(workspacePath)

    const hive = join(workspacePath, '.hive')
    expect(existsSync(join(hive, 'open-questions.md'))).toBe(true)
    expect(existsSync(join(hive, 'ideas', 'inbox.md'))).toBe(true)
    expect(existsSync(join(hive, 'baseline', 'README.md'))).toBe(true)
    expect(existsSync(join(hive, 'baseline', 'module-map.md'))).toBe(true)
    expect(existsSync(join(hive, 'baseline', 'runtime-flows.md'))).toBe(true)
    expect(existsSync(join(hive, 'baseline', 'state-storage.md'))).toBe(true)
    expect(existsSync(join(hive, 'baseline', 'test-gates.md'))).toBe(true)
    expect(existsSync(join(hive, 'baseline', 'risk-hotspots.md'))).toBe(true)
    expect(existsSync(join(hive, 'decisions', '.gitkeep'))).toBe(true)
    expect(existsSync(join(hive, 'research', '.gitkeep'))).toBe(true)
    expect(existsSync(join(hive, 'archive', '.gitkeep'))).toBe(true)
    expect(existsSync(join(hive, 'templates', 'open-questions.template.md'))).toBe(true)
    expect(existsSync(join(hive, 'templates', 'ideas-inbox.template.md'))).toBe(true)
    expect(existsSync(join(hive, 'templates', 'baseline.template.md'))).toBe(true)
  })

  test('does not overwrite existing baseline/module-map.md', () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-pm-baseline-'))
    tempDirs.push(workspacePath)

    ensurePmDocs(workspacePath)
    const custom = '# Custom Module Map\nWritten by AI.'
    writeFileSync(join(workspacePath, '.hive', 'baseline', 'module-map.md'), custom, 'utf8')

    ensurePmDocs(workspacePath)

    const content = readFileSync(join(workspacePath, '.hive', 'baseline', 'module-map.md'), 'utf8')
    expect(content).toBe(custom)
  })

  test('baseline README replaces {{PROJECT_NAME}} with workspace basename', () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'my-baseline-ws-'))
    tempDirs.push(workspacePath)

    ensurePmDocs(workspacePath)

    const content = readFileSync(join(workspacePath, '.hive', 'baseline', 'README.md'), 'utf8')
    expect(content).not.toContain('{{PROJECT_NAME}}')
    expect(content).toContain('my-baseline-ws-')
  })

  test('multiple calls on new files are idempotent', () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-pm-idem2-'))
    tempDirs.push(workspacePath)

    ensurePmDocs(workspacePath)
    const first = readFileSync(join(workspacePath, '.hive', 'open-questions.md'), 'utf8')

    ensurePmDocs(workspacePath)
    const second = readFileSync(join(workspacePath, '.hive', 'open-questions.md'), 'utf8')

    expect(first).toBe(second)
  })
})
