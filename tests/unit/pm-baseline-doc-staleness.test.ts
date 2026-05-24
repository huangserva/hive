import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

import { execFileSync } from 'node:child_process'
import { parseBaselineDoc } from '../../src/server/pm-baseline-doc.js'

const mockExec = vi.mocked(execFileSync)

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  vi.restoreAllMocks()
})

const DAY = 24 * 60 * 60 * 1000

const setupBaseline = (overrides: Record<string, string> = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-stale-'))
  tempDirs.push(dir)
  const baseline = join(dir, '.hive', 'baseline')
  mkdirSync(baseline, { recursive: true })
  const defaults: Record<string, string> = {
    'module-map.md': '# Module Map\n\nReal content.',
    'runtime-flows.md': '# Runtime Flows\n\nReal flows.',
    'state-storage.md': '# State Storage\n\nReal storage.',
    'test-gates.md': '# Test Gates\n\nReal gates.',
    'risk-hotspots.md': '# Risk Hotspots\n\nReal risks.',
  }
  for (const [file, content] of Object.entries({ ...defaults, ...overrides })) {
    writeFileSync(join(baseline, file), content, 'utf8')
  }
  return dir
}

const setMtimeDaysAgo = (filePath: string, daysAgo: number) => {
  const then = Date.now() - daysAgo * DAY
  const fs = require('node:fs') as typeof import('node:fs')
  const fd = fs.openSync(filePath, 'r')
  fs.futimesSync(fd, then / 1000, then / 1000)
  fs.closeSync(fd)
}

describe('pm-baseline-doc staleness', () => {
  test('module-map with mtime 1 day ago and 5 matching git changes produces staleReason', () => {
    const dir = setupBaseline()
    setMtimeDaysAgo(join(dir, '.hive', 'baseline', 'module-map.md'), 1)
    mockExec.mockReturnValue(
      'src/server/foo.ts\nsrc/server/bar.ts\nweb/src/App.tsx\nsrc/cli/main.ts\nweb/src/api.ts\n'
    )
    const result = parseBaselineDoc(join(dir, '.hive', 'baseline'))
    const modMap = result.children.find((c) => c.filename === 'module-map.md')
    expect(modMap?.staleReason).toBe('5 matching code changes')
    expect(modMap?.staleSince).toBeGreaterThan(0)
  })

  test('baseline file not in coverage map has null staleReason', () => {
    const dir = setupBaseline()
    const customFile = '# Custom File\n\nSome custom content.'
    writeFileSync(join(dir, '.hive', 'baseline', 'custom-doc.md'), customFile, 'utf8')
    const result = parseBaselineDoc(join(dir, '.hive', 'baseline'))
    const custom = result.children.find((c) => c.filename === 'custom-doc.md')
    expect(custom?.staleReason).toBeNull()
    expect(custom?.staleSince).toBeNull()
  })

  test('execFileSync throw returns null changedFiles — degraded path, no crash', () => {
    const dir = setupBaseline()
    setMtimeDaysAgo(join(dir, '.hive', 'baseline', 'module-map.md'), 5)
    mockExec.mockImplementation(() => {
      throw new Error('git not found')
    })
    const result = parseBaselineDoc(join(dir, '.hive', 'baseline'))
    const modMap = result.children.find((c) => c.filename === 'module-map.md')
    expect(modMap?.staleReason).toBeNull()
    expect(result.parseError).toBeNull()
  })

  test('git log returns empty → staleReason null', () => {
    const dir = setupBaseline()
    setMtimeDaysAgo(join(dir, '.hive', 'baseline', 'module-map.md'), 10)
    mockExec.mockReturnValue('')
    const result = parseBaselineDoc(join(dir, '.hive', 'baseline'))
    const modMap = result.children.find((c) => c.filename === 'module-map.md')
    expect(modMap?.staleReason).toBeNull()
  })

  test('staleHint picks child with most matching changes', () => {
    const dir = setupBaseline()
    setMtimeDaysAgo(join(dir, '.hive', 'baseline', 'module-map.md'), 3)
    setMtimeDaysAgo(join(dir, '.hive', 'baseline', 'risk-hotspots.md'), 2)
    let callCount = 0
    mockExec.mockImplementation(() => {
      callCount++
      if (callCount === 1) return 'a.ts\nb.ts\nc.ts\nd.ts\ne.ts\n'
      return 'x.ts\ny.ts\n'
    })
    const result = parseBaselineDoc(join(dir, '.hive', 'baseline'))
    expect(result.staleHint).toContain('module-map.md')
    expect(result.staleHint).toContain('5 matching code changes')
  })

  test('stub file keeps "still a stub" regardless of git changes', () => {
    const dir = setupBaseline({ 'module-map.md': '# Module Map\n\n待 AI 起草' })
    setMtimeDaysAgo(join(dir, '.hive', 'baseline', 'module-map.md'), 10)
    mockExec.mockReturnValue('a.ts\nb.ts\n')
    const result = parseBaselineDoc(join(dir, '.hive', 'baseline'))
    const modMap = result.children.find((c) => c.filename === 'module-map.md')
    expect(modMap?.isStub).toBe(true)
    expect(modMap?.staleReason).toBe('still a stub')
    expect(result.staleHint).toContain('still need drafting')
  })

  test('{ts,tsx} brace expansion generates two pathspecs in git call', () => {
    const dir = setupBaseline()
    setMtimeDaysAgo(join(dir, '.hive', 'baseline', 'module-map.md'), 1)
    mockExec.mockReturnValue('')
    parseBaselineDoc(join(dir, '.hive', 'baseline'))
    const callArgs = mockExec.mock.calls[0]
    const gitArgs = callArgs?.[1] as string[]
    expect(gitArgs).toContain(':(glob)web/src/**/*.ts')
    expect(gitArgs).toContain(':(glob)web/src/**/*.tsx')
  })
})
