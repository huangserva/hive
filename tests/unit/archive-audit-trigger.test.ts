import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import {
  createArchiveAuditTrigger,
  inspectArchiveAudit,
} from '../../src/server/archive-audit-trigger.js'

const makeDoneSection = (lineCount: number) =>
  [
    '# Tasks',
    '',
    '## Done',
    ...Array.from({ length: lineCount }, (_, index) => `- [x] item ${index}`),
  ].join('\n')

describe('archive audit trigger', () => {
  test('flags tasks Done sections above the archive threshold', () => {
    const root = mkdtempSync(join(tmpdir(), 'archive-audit-tasks-'))
    mkdirSync(join(root, '.hive'), { recursive: true })
    writeFileSync(join(root, '.hive', 'tasks.md'), makeDoneSection(201))

    const findings = inspectArchiveAudit(root, new Date('2026-05-26T00:00:00Z'))

    expect(findings).toContainEqual(
      expect.objectContaining({
        archiveMonth: '2026-05',
        kind: 'tasks-done',
        message: expect.stringContaining('tasks.md Done 段已 201 行'),
      })
    )
  })

  test('flags reports and research directories above archive thresholds', () => {
    const root = mkdtempSync(join(tmpdir(), 'archive-audit-dirs-'))
    mkdirSync(join(root, '.hive', 'reports'), { recursive: true })
    mkdirSync(join(root, '.hive', 'research'), { recursive: true })
    for (let index = 0; index < 21; index += 1) {
      writeFileSync(join(root, '.hive', 'reports', `report-${index}.html`), '<html></html>')
    }
    for (let index = 0; index < 16; index += 1) {
      writeFileSync(join(root, '.hive', 'research', `note-${index}.md`), '# note')
    }

    const findings = inspectArchiveAudit(root, new Date('2026-05-26T00:00:00Z'))

    expect(findings.map((finding) => finding.kind)).toEqual(['reports-count', 'research-count'])
  })

  test('dedupes archive audit findings within the same month', () => {
    const root = mkdtempSync(join(tmpdir(), 'archive-audit-dedupe-'))
    mkdirSync(join(root, '.hive'), { recursive: true })
    writeFileSync(join(root, '.hive', 'tasks.md'), makeDoneSection(201))
    const trigger = createArchiveAuditTrigger({ now: () => new Date('2026-05-26T00:00:00Z') })

    expect(trigger.check(root)).toHaveLength(1)
    expect(trigger.check(root)).toEqual([])
  })
})
