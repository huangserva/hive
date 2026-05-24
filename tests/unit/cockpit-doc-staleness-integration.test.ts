import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

import { execFileSync } from 'node:child_process'
import { parseCockpit } from '../../src/server/cockpit-doc.js'

const mockExec = vi.mocked(execFileSync)

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const DAY = 24 * 60 * 60 * 1000

const setupWorkspace = (baselineOverrides: Record<string, string> = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-cockpit-stale-'))
  tempDirs.push(dir)
  const hive = join(dir, '.hive')
  mkdirSync(hive, { recursive: true })
  mkdirSync(join(hive, 'baseline'), { recursive: true })
  mkdirSync(join(hive, 'ideas'), { recursive: true })
  mkdirSync(join(hive, 'decisions'), { recursive: true })
  mkdirSync(join(hive, 'archive'), { recursive: true })
  mkdirSync(join(hive, 'research'), { recursive: true })
  mkdirSync(join(hive, 'templates'), { recursive: true })

  writeFileSync(join(hive, 'plan.md'), '---\ntitle: Test\n---\n## 目标\n\nGoal.', 'utf8')
  writeFileSync(
    join(hive, 'open-questions.md'),
    '# Open Questions\n\n### 🟢 low\n\n- [ ] **Q** Low',
    'utf8'
  )
  writeFileSync(join(hive, 'ideas', 'inbox.md'), '# Ideas\n\n## inbox\n\n## promoted\n', 'utf8')
  writeFileSync(join(hive, 'tasks.md'), '## In progress\n\n- [ ] Task\n', 'utf8')

  const defaults: Record<string, string> = {
    'module-map.md': '# Module Map\n\nReal content.',
    'runtime-flows.md': '# Runtime Flows\n\nReal content.',
    'state-storage.md': '# State Storage\n\nReal content.',
    'test-gates.md': '# Test Gates\n\nReal content.',
    'risk-hotspots.md': '# Risk Hotspots\n\nReal content.',
  }
  for (const [file, content] of Object.entries({ ...defaults, ...baselineOverrides })) {
    writeFileSync(join(hive, 'baseline', file), content, 'utf8')
  }
  writeFileSync(join(hive, 'research', '2026-05-20-test.md'), '# Test\n', 'utf8')

  return dir
}

const setMtimeDaysAgo = (filePath: string, daysAgo: number) => {
  const then = Date.now() - daysAgo * DAY
  const fs = require('node:fs') as typeof import('node:fs')
  const fd = fs.openSync(filePath, 'r')
  fs.futimesSync(fd, then / 1000, then / 1000)
  fs.closeSync(fd)
}

describe('cockpit-doc staleness integration with aiActions', () => {
  test('stale baseline produces audit aiAction', () => {
    const dir = setupWorkspace()
    setMtimeDaysAgo(join(dir, '.hive', 'baseline', 'module-map.md'), 5)
    mockExec.mockReturnValue('src/server/foo.ts\nsrc/server/bar.ts\nsrc/server/baz.ts\n')
    const result = parseCockpit(dir)
    const auditActions = result.aiActions.filter((a) => a.type === 'audit')
    expect(auditActions).toHaveLength(1)
    expect(auditActions[0]?.targetTab).toBe('baseline')
    expect(auditActions[0]?.priority).toBe('medium')
    expect(auditActions[0]?.text).toContain('matching code changes')
  })

  test('no staleness produces no audit aiAction', () => {
    const dir = setupWorkspace()
    mockExec.mockReturnValue('')
    const result = parseCockpit(dir)
    const auditActions = result.aiActions.filter((a) => a.type === 'audit')
    expect(auditActions).toHaveLength(0)
  })

  test('new staleHint flows into aiActions text', () => {
    const dir = setupWorkspace({ 'module-map.md': '# Module Map\n\n待 AI 起草' })
    mockExec.mockReturnValue('a.ts\nb.ts\n')
    const result = parseCockpit(dir)
    const auditActions = result.aiActions.filter((a) => a.type === 'audit')
    expect(auditActions).toHaveLength(1)
    expect(auditActions[0]?.text).toContain('still need drafting')
  })
})
