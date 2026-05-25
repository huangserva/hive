import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { parseReportsDoc } from '../../src/server/pm-reports-doc.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const setupDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-reports-'))
  tempDirs.push(dir)
  return dir
}

const touch = (path: string, iso: string) => {
  const date = new Date(iso)
  utimesSync(path, date, date)
}

describe('parseReportsDoc', () => {
  test('missing dir returns empty entries with no error', () => {
    const result = parseReportsDoc('/definitely/does/not/exist')
    expect(result.entries).toEqual([])
    expect(result.totalCount).toBe(0)
    expect(result.parseError).toBeNull()
  })

  test('empty dir returns empty entries', () => {
    const dir = setupDir()
    const result = parseReportsDoc(dir)
    expect(result.entries).toEqual([])
    expect(result.totalCount).toBe(0)
    expect(result.parseError).toBeNull()
  })

  test('parses html files extracting filename, date, title, topic, mtime, and size', () => {
    const dir = setupDir()
    const reportPath = join(dir, '2026-05-25-cockpit-e2e.html')
    writeFileSync(
      reportPath,
      '<!doctype html><html><head><title>Cockpit E2E Report</title></head><body>OK</body></html>',
      'utf8'
    )
    touch(reportPath, '2026-05-25T10:30:00.000Z')

    const result = parseReportsDoc(dir)
    expect(result.entries).toEqual([
      expect.objectContaining({
        date: '2026-05-25',
        filename: '2026-05-25-cockpit-e2e.html',
        mtime: '2026-05-25T10:30:00.000Z',
        size: 1,
        title: 'Cockpit E2E Report',
        topic: 'cockpit e2e',
      }),
    ])
    expect(result.totalCount).toBe(1)
  })

  test('falls back to slug when html title is missing', () => {
    const dir = setupDir()
    writeFileSync(
      join(dir, '2026-05-25-no-title.html'),
      '<html><body>No title</body></html>',
      'utf8'
    )

    const result = parseReportsDoc(dir)
    expect(result.entries[0]?.title).toBe('no title')
  })

  test('sorts entries newest-first by file mtime', () => {
    const dir = setupDir()
    const oldPath = join(dir, '2026-05-25-old.html')
    const newPath = join(dir, '2026-05-20-newer-mtime.html')
    writeFileSync(oldPath, '<title>Old</title>', 'utf8')
    writeFileSync(newPath, '<title>New</title>', 'utf8')
    touch(oldPath, '2026-05-25T08:00:00.000Z')
    touch(newPath, '2026-05-25T09:00:00.000Z')

    const result = parseReportsDoc(dir)
    expect(result.entries.map((entry) => entry.filename)).toEqual([
      '2026-05-20-newer-mtime.html',
      '2026-05-25-old.html',
    ])
  })

  test('skips non-html files and dotfiles', () => {
    const dir = setupDir()
    mkdirSync(join(dir, 'nested'), { recursive: true })
    writeFileSync(join(dir, '.gitkeep'), '', 'utf8')
    writeFileSync(join(dir, 'note.md'), '# note\n', 'utf8')
    writeFileSync(join(dir, '2026-05-25-report.html'), '<title>Report</title>', 'utf8')

    const result = parseReportsDoc(dir)
    expect(result.entries.map((entry) => entry.filename)).toEqual(['2026-05-25-report.html'])
  })
})
