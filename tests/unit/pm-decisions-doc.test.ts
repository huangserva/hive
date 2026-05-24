import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { parseDecisionsDoc } from '../../src/server/pm-decisions-doc.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const setupDecisionsDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-decisions-'))
  tempDirs.push(dir)
  return dir
}

describe('parseDecisionsDoc', () => {
  test('parses draft and adopted decisions', () => {
    const dir = setupDecisionsDir()
    writeFileSync(
      join(dir, 'draft-2026-05-20-schema-change.md'),
      '# 决策：schema change\n\n**状态**: 草稿',
      'utf8'
    )
    writeFileSync(
      join(dir, '2026-05-15-monorepo.md'),
      '# 决策：monorepo\n\n**状态**: 已采纳',
      'utf8'
    )
    writeFileSync(join(dir, '2026-05-10-rest-api.md'), '# 决策：REST API\n\nsome content', 'utf8')

    const result = parseDecisionsDoc(dir)
    expect(result.drafts).toHaveLength(1)
    expect(result.adopted).toHaveLength(2)
    expect(result.parseError).toBeNull()
  })

  test('draft- prefix identifies draft status', () => {
    const dir = setupDecisionsDir()
    writeFileSync(
      join(dir, 'draft-2026-05-20-schema.md'),
      '# 决策：schema\n\n**状态**: 已采纳',
      'utf8'
    )

    const result = parseDecisionsDoc(dir)
    expect(result.drafts[0]?.status).toBe('draft')
    expect(result.drafts[0]?.filename).toBe('draft-2026-05-20-schema.md')
  })

  test('adopted by default when no draft prefix and no status match', () => {
    const dir = setupDecisionsDir()
    writeFileSync(join(dir, '2026-05-15-testing.md'), '# Testing strategy\n\nContent.', 'utf8')

    const result = parseDecisionsDoc(dir)
    expect(result.adopted[0]?.status).toBe('adopted')
  })

  test('superseded from status content', () => {
    const dir = setupDecisionsDir()
    writeFileSync(join(dir, '2026-05-01-old.md'), '# 决策：old\n\n**状态**: 废弃', 'utf8')

    const result = parseDecisionsDoc(dir)
    expect(result.adopted[0]?.status).toBe('superseded')
  })

  test('non-existent directory returns empty', () => {
    const r = parseDecisionsDoc('/no/such/dir')
    expect(r.drafts).toEqual([])
    expect(r.adopted).toEqual([])
    expect(r.parseError).toBeNull()
  })

  test('skips non-.md files and README.md', () => {
    const dir = setupDecisionsDir()
    writeFileSync(join(dir, '2026-05-01-test.md'), '# Test\n', 'utf8')
    writeFileSync(join(dir, 'notes.txt'), 'notes', 'utf8')
    writeFileSync(join(dir, 'README.md'), '# Decisions', 'utf8')

    const result = parseDecisionsDoc(dir)
    expect(result.adopted).toHaveLength(1)
    expect(result.adopted[0]?.filename).toBe('2026-05-01-test.md')
  })

  test('parses filename date and slug', () => {
    const dir = setupDecisionsDir()
    writeFileSync(join(dir, '2026-05-15-monorepo.md'), '# Monorepo\n', 'utf8')

    const result = parseDecisionsDoc(dir)
    expect(result.adopted[0]?.date).toBe('2026-05-15')
    expect(result.adopted[0]?.slug).toBe('monorepo')
  })
})
