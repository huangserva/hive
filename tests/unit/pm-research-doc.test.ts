import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { parseResearchDoc } from '../../src/server/pm-research-doc.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const setupDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-research-'))
  tempDirs.push(dir)
  return dir
}

describe('parseResearchDoc', () => {
  test('parses .md files extracting date, title, topic, size', () => {
    const dir = setupDir()
    writeFileSync(
      join(dir, '2026-05-20-api-design.md'),
      '# API Design Notes\n\nSome research content.\nMore lines.',
      'utf8'
    )
    writeFileSync(
      join(dir, '2026-05-15-db-schema.md'),
      '# Database Schema Research\n\nContent here.',
      'utf8'
    )

    const result = parseResearchDoc(dir)
    expect(result.entries).toHaveLength(2)
    expect(result.totalCount).toBe(2)
    expect(result.parseError).toBeNull()
  })

  test('sorts entries newest-first by date', () => {
    const dir = setupDir()
    writeFileSync(join(dir, '2026-04-10-old.md'), '# Old\n', 'utf8')
    writeFileSync(join(dir, '2026-05-20-new.md'), '# New\n', 'utf8')
    writeFileSync(join(dir, '2026-05-15-mid.md'), '# Mid\n', 'utf8')

    const result = parseResearchDoc(dir)
    const dates = result.entries.map((e) => e.date)
    expect(dates).toEqual(['2026-05-20', '2026-05-15', '2026-04-10'])
  })

  test('extracts date from YYYY-MM-DD-slug filename', () => {
    const dir = setupDir()
    writeFileSync(join(dir, '2026-05-20-api-design.md'), '# Title\n', 'utf8')

    const result = parseResearchDoc(dir)
    expect(result.entries[0]?.date).toBe('2026-05-20')
  })

  test('extracts topic from slug part of filename', () => {
    const dir = setupDir()
    writeFileSync(join(dir, '2026-05-20-api-design.md'), '# Title\n', 'utf8')

    const result = parseResearchDoc(dir)
    expect(result.entries[0]?.topic).toBe('api design')
  })

  test('extracts title from first # heading in content', () => {
    const dir = setupDir()
    writeFileSync(join(dir, '2026-05-20-test.md'), '# My Research Title\n\nBody.', 'utf8')

    const result = parseResearchDoc(dir)
    expect(result.entries[0]?.title).toBe('My Research Title')
  })

  test('falls back to slug when no # heading', () => {
    const dir = setupDir()
    writeFileSync(join(dir, '2026-05-20-no-heading.md'), 'Just plain text.\n', 'utf8')

    const result = parseResearchDoc(dir)
    expect(result.entries[0]?.title).toBe('no heading')
  })

  test('counts lines for size field', () => {
    const dir = setupDir()
    writeFileSync(join(dir, '2026-05-20-sized.md'), '# T\n\nLine 2\nLine 3\nLine 4', 'utf8')

    const result = parseResearchDoc(dir)
    expect(result.entries[0]?.size).toBe(5)
  })

  test('skips non-.md files', () => {
    const dir = setupDir()
    writeFileSync(join(dir, '2026-05-20-research.md'), '# Research\n', 'utf8')
    writeFileSync(join(dir, 'notes.txt'), 'notes', 'utf8')
    writeFileSync(join(dir, 'image.png'), 'binary', 'utf8')

    const result = parseResearchDoc(dir)
    expect(result.entries).toHaveLength(1)
  })

  test('skips dotfiles', () => {
    const dir = setupDir()
    writeFileSync(join(dir, '.gitkeep'), '', 'utf8')
    writeFileSync(join(dir, '2026-05-20-real.md'), '# Real\n', 'utf8')

    const result = parseResearchDoc(dir)
    expect(result.entries).toHaveLength(1)
  })

  test('empty dir returns empty entries', () => {
    const dir = setupDir()
    const result = parseResearchDoc(dir)
    expect(result.entries).toEqual([])
    expect(result.totalCount).toBe(0)
    expect(result.parseError).toBeNull()
  })

  test('missing dir returns empty entries with no error', () => {
    const result = parseResearchDoc('/definitely/does/not/exist')
    expect(result.entries).toEqual([])
    expect(result.totalCount).toBe(0)
    expect(result.parseError).toBeNull()
  })

  test('filename without date pattern gets empty date string', () => {
    const dir = setupDir()
    writeFileSync(join(dir, 'general-notes.md'), '# General\n', 'utf8')

    const result = parseResearchDoc(dir)
    expect(result.entries[0]?.date).toBe('')
    expect(result.entries[0]?.topic).toBe('general notes')
  })
})
