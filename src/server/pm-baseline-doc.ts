import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface BaselineFile {
  exists: boolean
  filename: string
  isStub: boolean
  size: number
  staleReason: string | null
  staleSince: number | null
  title: string
}

export interface ParsedBaseline {
  children: BaselineFile[]
  parseError: string | null
  readme: { raw: string; title: string } | null
  staleHint: string | null
}

const BASELINE_CHILDREN = [
  'module-map.md',
  'runtime-flows.md',
  'state-storage.md',
  'test-gates.md',
  'risk-hotspots.md',
] as const

const BASELINE_COVERAGE_MAP: Record<string, string[]> = {
  'module-map.md': [
    'src/server/**/*.ts',
    'web/src/**/*.{ts,tsx}',
    'src/cli/**/*.ts',
    'src/shared/**/*.ts',
  ],
  'runtime-flows.md': [
    'src/server/team-operations.ts',
    'src/server/feishu-*.ts',
    'src/server/cockpit-*.ts',
    'src/server/agent-runtime*.ts',
  ],
  'state-storage.md': ['src/server/sqlite-schema*.ts', 'src/server/runtime-database.ts'],
  'test-gates.md': ['package.json', 'vitest.config.*', 'tests/**/*.ts'],
  'risk-hotspots.md': ['src/server/**/*.ts'],
}

const titleFromMarkdown = (content: string, fallback: string) =>
  /^#\s+(.+?)\s*$/m.exec(content)?.[1]?.trim() ?? fallback

const lineCount = (content: string) => (content ? content.split(/\r?\n/).length : 0)

const isStubContent = (content: string) => /待 AI 起草|\(待填\)|（待填）/.test(content)

const expandBracePattern = (pattern: string): string[] => {
  const match = /^(.*)\{([^}]+)\}(.*)$/.exec(pattern)
  if (!match) return [pattern]

  const prefix = match[1] ?? ''
  const body = match[2] ?? ''
  const suffix = match[3] ?? ''
  return body.split(',').flatMap((part) => expandBracePattern(`${prefix}${part}${suffix}`))
}

const toGitPathspec = (pattern: string): string =>
  /[*?[]/.test(pattern) ? `:(glob)${pattern}` : pattern

const changedFilesSince = (
  workspacePath: string,
  baselineMtimeMs: number,
  patterns: string[]
): string[] | null => {
  const pathspecs = patterns.flatMap(expandBracePattern).map(toGitPathspec)
  if (pathspecs.length === 0) return []

  try {
    const output = execFileSync(
      'git',
      [
        'log',
        `--since=${new Date(baselineMtimeMs).toISOString()}`,
        '--name-only',
        '--pretty=format:',
        '--',
        ...pathspecs,
      ],
      {
        cwd: workspacePath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    )

    return Array.from(
      new Set(
        output
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      )
    )
  } catch {
    return null
  }
}

const matchingChangeCount = (staleReason: string | null): number => {
  const count = staleReason?.match(/^(\d+) matching code changes$/)?.[1]
  return count ? Number(count) : 0
}

const daysSince = (mtimeMs: number): number =>
  Math.max(0, Math.floor((Date.now() - mtimeMs) / (24 * 60 * 60 * 1000)))

export const parseBaselineDoc = (baselineDir: string): ParsedBaseline => {
  const parsed: ParsedBaseline = {
    children: [],
    parseError: null,
    readme: null,
    staleHint: null,
  }
  try {
    const workspacePath = dirname(dirname(baselineDir))
    const readmePath = join(baselineDir, 'README.md')
    if (existsSync(readmePath)) {
      const raw = readFileSync(readmePath, 'utf8')
      parsed.readme = { raw, title: titleFromMarkdown(raw, 'Baseline') }
    }

    const knownFiles = new Set<string>(BASELINE_CHILDREN)
    if (existsSync(baselineDir)) {
      for (const filename of readdirSync(baselineDir)) {
        if (filename.endsWith('.md') && filename !== 'README.md') knownFiles.add(filename)
      }
    }

    parsed.children = Array.from(knownFiles)
      .sort()
      .map((filename) => {
        const filePath = join(baselineDir, filename)
        if (!existsSync(filePath)) {
          return {
            exists: false,
            filename,
            isStub: false,
            size: 0,
            staleReason: null,
            staleSince: null,
            title: filename.replace(/\.md$/, ''),
          }
        }
        const raw = readFileSync(filePath, 'utf8')
        const baselineMtimeMs = statSync(filePath).mtimeMs
        const isStub = isStubContent(raw)
        const changedFiles = changedFilesSince(
          workspacePath,
          baselineMtimeMs,
          BASELINE_COVERAGE_MAP[filename] ?? []
        )
        const staleReason = isStub
          ? 'still a stub'
          : changedFiles && changedFiles.length > 0
            ? `${changedFiles.length} matching code changes`
            : null
        return {
          exists: true,
          filename,
          isStub,
          size: lineCount(raw),
          staleReason,
          staleSince: staleReason ? baselineMtimeMs : null,
          title: titleFromMarkdown(raw, filename.replace(/\.md$/, '')),
        }
      })

    const missing = parsed.children.filter((child) => !child.exists).length
    const stubs = parsed.children.filter((child) => child.isStub).length
    const staleChildren = parsed.children
      .filter((child) => matchingChangeCount(child.staleReason) > 0)
      .sort((a, b) => matchingChangeCount(b.staleReason) - matchingChangeCount(a.staleReason))
    if (missing > 0) parsed.staleHint = `${missing} baseline files missing`
    else if (stubs > 0) parsed.staleHint = `${stubs} baseline files still need drafting`
    else if (staleChildren[0]?.staleSince) {
      const staleChild = staleChildren[0]
      const staleSince = staleChild.staleSince
      if (staleSince) {
        parsed.staleHint = `${staleChild.filename} last updated ${daysSince(staleSince)} days ago, ${matchingChangeCount(staleChild.staleReason)} matching code changes since then`
      }
    }
  } catch (error) {
    parsed.parseError = error instanceof Error ? error.message : String(error)
  }
  return parsed
}
