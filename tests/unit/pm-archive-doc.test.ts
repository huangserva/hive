import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { parseArchiveDoc } from '../../src/server/pm-archive-doc.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const setupArchiveDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-archive-'))
  tempDirs.push(dir)
  return dir
}

describe('parseArchiveDoc', () => {
  test('parses YYYY-MM directories with file counts', () => {
    const dir = setupArchiveDir()
    mkdirSync(join(dir, '2026-05'), { recursive: true })
    mkdirSync(join(dir, '2026-04'), { recursive: true })
    writeFileSync(join(dir, '2026-05', 'plan.md'), 'old plan', 'utf8')
    writeFileSync(join(dir, '2026-05', 'tasks.md'), 'old tasks', 'utf8')
    writeFileSync(join(dir, '2026-04', 'plan.md'), 'april plan', 'utf8')

    const result = parseArchiveDoc(dir)
    expect(result.months).toHaveLength(2)
    expect(result.parseError).toBeNull()
  })

  test('sorts months newest-first', () => {
    const dir = setupArchiveDir()
    mkdirSync(join(dir, '2026-03'), { recursive: true })
    mkdirSync(join(dir, '2026-05'), { recursive: true })
    mkdirSync(join(dir, '2026-04'), { recursive: true })

    const result = parseArchiveDoc(dir)
    expect(result.months.map((m) => m.month)).toEqual(['2026-05', '2026-04', '2026-03'])
  })

  test('counts files per month (excluding dotfiles)', () => {
    const dir = setupArchiveDir()
    mkdirSync(join(dir, '2026-05'), { recursive: true })
    writeFileSync(join(dir, '2026-05', 'plan.md'), 'x', 'utf8')
    writeFileSync(join(dir, '2026-05', 'tasks.md'), 'x', 'utf8')
    writeFileSync(join(dir, '2026-05', '.gitkeep'), '', 'utf8')

    const result = parseArchiveDoc(dir)
    expect(result.months[0]?.fileCount).toBe(2)
    expect(result.months[0]?.files).toEqual(['plan.md', 'tasks.md'])
  })

  test('ignores non-YYYY-MM directories', () => {
    const dir = setupArchiveDir()
    mkdirSync(join(dir, '2026-05'), { recursive: true })
    mkdirSync(join(dir, 'misc'), { recursive: true })
    writeFileSync(join(dir, '2026-05', 'plan.md'), 'x', 'utf8')
    writeFileSync(join(dir, 'misc', 'notes.txt'), 'x', 'utf8')

    const result = parseArchiveDoc(dir)
    expect(result.months).toHaveLength(1)
    expect(result.months[0]?.month).toBe('2026-05')
  })

  test('non-existent directory returns empty', () => {
    const result = parseArchiveDoc('/no/such/dir')
    expect(result.months).toEqual([])
    expect(result.parseError).toBeNull()
  })

  test('empty archive dir returns empty months', () => {
    const dir = setupArchiveDir()
    const result = parseArchiveDoc(dir)
    expect(result.months).toEqual([])
  })
})
