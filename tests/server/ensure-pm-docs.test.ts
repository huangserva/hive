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
})
