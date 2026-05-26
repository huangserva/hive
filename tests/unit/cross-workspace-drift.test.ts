import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { detectCrossWorkspaceDrift } from '../../src/server/cross-workspace-drift.js'

const writeBaseline = (workspacePath: string, files: string[]) => {
  mkdirSync(join(workspacePath, '.hive', 'baseline'), { recursive: true })
  mkdirSync(join(workspacePath, '.hive'), { recursive: true })
  writeFileSync(join(workspacePath, '.hive', 'PROTOCOL.md'), '# protocol')
  for (const file of files) {
    writeFileSync(join(workspacePath, '.hive', 'baseline', file), '# baseline')
  }
}

describe('cross workspace drift', () => {
  test('skips drift detection for a single workspace', () => {
    const findings = detectCrossWorkspaceDrift([{ id: 'one', name: 'One', path: '/tmp/one' }])

    expect(findings).toEqual([])
  })

  test('reports schema version drift across multiple workspaces', () => {
    const findings = detectCrossWorkspaceDrift(
      [
        { id: 'one', name: 'One', path: '/tmp/one' },
        { id: 'two', name: 'Two', path: '/tmp/two' },
      ],
      { getSchemaVersion: (workspace) => (workspace.id === 'one' ? 27 : 25) }
    )

    expect(findings).toContainEqual(
      expect.objectContaining({
        kind: 'schema-version',
        message: expect.stringContaining('schema version drift'),
      })
    )
  })

  test('reports missing PROTOCOL and baseline files', () => {
    const root = mkdtempSync(join(tmpdir(), 'cross-workspace-drift-'))
    const complete = join(root, 'complete')
    const missing = join(root, 'missing')
    writeBaseline(complete, [
      'README.md',
      'module-map.md',
      'runtime-flows.md',
      'state-storage.md',
      'test-gates.md',
      'risk-hotspots.md',
    ])
    mkdirSync(join(missing, '.hive', 'baseline'), { recursive: true })
    writeFileSync(join(missing, '.hive', 'baseline', 'README.md'), '# baseline')

    const findings = detectCrossWorkspaceDrift([
      { id: 'complete', name: 'Complete', path: complete },
      { id: 'missing', name: 'Missing', path: missing },
    ])

    expect(findings.map((finding) => finding.kind)).toContain('protocol-missing')
    expect(findings).toContainEqual(
      expect.objectContaining({
        kind: 'baseline-missing',
        message: expect.stringContaining('Missing 缺 baseline 文件'),
      })
    )
  })
})
