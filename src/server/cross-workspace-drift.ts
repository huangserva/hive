import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { WorkspaceSummary } from '../shared/types.js'
import { CURRENT_SCHEMA_VERSION } from './sqlite-schema.js'

const BASELINE_FILES = [
  'README.md',
  'module-map.md',
  'runtime-flows.md',
  'state-storage.md',
  'test-gates.md',
  'risk-hotspots.md',
]

export type CrossWorkspaceDriftKind = 'baseline-missing' | 'protocol-missing' | 'schema-version'

export interface CrossWorkspaceDriftFinding {
  kind: CrossWorkspaceDriftKind
  message: string
}

export interface CrossWorkspaceDriftOptions {
  getSchemaVersion?: (workspace: WorkspaceSummary) => number | null
}

export const detectCrossWorkspaceDrift = (
  workspaces: WorkspaceSummary[],
  { getSchemaVersion = () => CURRENT_SCHEMA_VERSION }: CrossWorkspaceDriftOptions = {}
): CrossWorkspaceDriftFinding[] => {
  if (workspaces.length <= 1) return []

  const findings: CrossWorkspaceDriftFinding[] = []
  const schemaVersions = workspaces
    .map((workspace) => ({ workspace, version: getSchemaVersion(workspace) }))
    .filter(
      (item): item is { workspace: WorkspaceSummary; version: number } => item.version !== null
    )
  const uniqueSchemaVersions = new Set(schemaVersions.map((item) => item.version))
  if (uniqueSchemaVersions.size > 1) {
    findings.push({
      kind: 'schema-version',
      message: `schema version drift: ${schemaVersions
        .map((item) => `${item.workspace.name}=${item.version}`)
        .join(', ')}`,
    })
  }

  for (const workspace of workspaces) {
    const hiveDir = join(workspace.path, '.hive')
    if (!existsSync(join(hiveDir, 'PROTOCOL.md'))) {
      findings.push({
        kind: 'protocol-missing',
        message: `${workspace.name} 缺 .hive/PROTOCOL.md`,
      })
    }

    const missingBaselineFiles = BASELINE_FILES.filter(
      (file) => !existsSync(join(hiveDir, 'baseline', file))
    )
    if (missingBaselineFiles.length > 0) {
      findings.push({
        kind: 'baseline-missing',
        message: `${workspace.name} 缺 baseline 文件：${missingBaselineFiles.join(', ')}`,
      })
    }
  }

  return findings
}
