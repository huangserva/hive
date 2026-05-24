import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { parseBaselineDoc } from '../../src/server/pm-baseline-doc.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const setupBaselineDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-baseline-'))
  tempDirs.push(dir)
  mkdirSync(dir, { recursive: true })
  return dir
}

const STUB_CONTENT = '# Module Map\n\n待 AI 起草。保持 200 行以内。'
const REAL_CONTENT =
  '# Module Map\n\n## Backend\n\nsrc/server/ has the runtime and routes.\n\n## Frontend\n\nweb/src/ has React components.\n'

describe('parseBaselineDoc', () => {
  test('reads README and children files', () => {
    const dir = setupBaselineDir()
    writeFileSync(join(dir, 'README.md'), '# Baseline · TestProject', 'utf8')
    writeFileSync(join(dir, 'module-map.md'), REAL_CONTENT, 'utf8')
    writeFileSync(join(dir, 'runtime-flows.md'), STUB_CONTENT, 'utf8')

    const result = parseBaselineDoc(dir)

    expect(result.readme).toEqual({
      raw: '# Baseline · TestProject',
      title: 'Baseline · TestProject',
    })
    expect(result.children.length).toBeGreaterThanOrEqual(2)
    expect(result.parseError).toBeNull()
  })

  test('detects isStub from "待 AI 起草" content', () => {
    const dir = setupBaselineDir()
    writeFileSync(join(dir, 'runtime-flows.md'), STUB_CONTENT, 'utf8')

    const flows = parseBaselineDoc(dir).children.find((c) => c.filename === 'runtime-flows.md')
    expect(flows?.isStub).toBe(true)
  })

  test('real content has isStub=false', () => {
    const dir = setupBaselineDir()
    writeFileSync(join(dir, 'module-map.md'), REAL_CONTENT, 'utf8')

    const moduleMap = parseBaselineDoc(dir).children.find((c) => c.filename === 'module-map.md')
    expect(moduleMap?.isStub).toBe(false)
    expect(moduleMap?.exists).toBe(true)
  })

  test('missing file has exists=false', () => {
    const dir = setupBaselineDir()

    const moduleMap = parseBaselineDoc(dir).children.find((c) => c.filename === 'module-map.md')
    expect(moduleMap?.exists).toBe(false)
    expect(moduleMap?.size).toBe(0)
  })

  test('staleHint reports missing files', () => {
    const dir = setupBaselineDir()

    const result = parseBaselineDoc(dir)
    expect(result.staleHint).toContain('baseline files missing')
  })

  test('staleHint reports stub files when all exist', () => {
    const dir = setupBaselineDir()
    for (const name of [
      'module-map.md',
      'runtime-flows.md',
      'state-storage.md',
      'test-gates.md',
      'risk-hotspots.md',
    ]) {
      writeFileSync(join(dir, name), STUB_CONTENT, 'utf8')
    }

    const result = parseBaselineDoc(dir)
    expect(result.staleHint).toContain('still need drafting')
    expect(result.staleHint).not.toContain('missing')
  })

  test('non-existent directory still lists known children as missing', () => {
    const result = parseBaselineDoc('/definitely/does/not/exist')
    expect(result.children.length).toBeGreaterThan(0)
    expect(result.children.every((c) => !c.exists)).toBe(true)
    expect(result.readme).toBeNull()
    expect(result.parseError).toBeNull()
  })
})
