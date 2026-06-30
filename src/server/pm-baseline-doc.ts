import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { readCachedTextFile } from './pm-file-cache.js'

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

interface ChangedFile {
  path: string
  timestampMs: number
}

const escapeRegExp = (value: string) => value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')

const globPatternToRegExp = (pattern: string): RegExp => {
  const expanded = expandBracePattern(pattern)
  const alternatives = expanded.map((part) => {
    let output = ''
    for (let index = 0; index < part.length; index += 1) {
      const char = part[index]
      const next = part[index + 1]
      if (char === '*' && next === '*') {
        const afterNext = part[index + 2]
        if (afterNext === '/') {
          output += '(?:.*/)?'
          index += 2
        } else {
          output += '.*'
          index += 1
        }
      } else if (char === '*') {
        output += '[^/]*'
      } else if (char === '?') {
        output += '[^/]'
      } else {
        output += escapeRegExp(char ?? '')
      }
    }
    return output
  })
  return new RegExp(`^(?:${alternatives.join('|')})$`)
}

const matchesAnyPattern = (path: string, patterns: string[]): boolean => {
  if (patterns.length === 0) return false
  return patterns.some((pattern) => globPatternToRegExp(pattern).test(path))
}

const changedFilesSince = (
  workspacePath: string,
  oldestBaselineMtimeMs: number,
  patterns: string[]
): ChangedFile[] | null => {
  const pathspecs = Array.from(new Set(patterns.flatMap(expandBracePattern).map(toGitPathspec)))
  if (pathspecs.length === 0) return []

  try {
    const output = execFileSync(
      'git',
      [
        'log',
        `--since=${new Date(oldestBaselineMtimeMs).toISOString()}`,
        '--name-only',
        '--pretty=format:__HIVE_COMMIT__%ct',
        '--',
        ...pathspecs,
      ],
      {
        cwd: workspacePath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    )

    const changedByPath = new Map<string, number>()
    let currentTimestampMs = 0
    for (const rawLine of output.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line) continue
      if (line.startsWith('__HIVE_COMMIT__')) {
        currentTimestampMs = Number(line.slice('__HIVE_COMMIT__'.length)) * 1000
        continue
      }
      const previous = changedByPath.get(line) ?? 0
      changedByPath.set(line, Math.max(previous, currentTimestampMs))
    }
    return [...changedByPath.entries()].map(([path, timestampMs]) => ({ path, timestampMs }))
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
      const raw = readCachedTextFile(readmePath)
      parsed.readme = { raw, title: titleFromMarkdown(raw, 'Baseline') }
    }

    const knownFiles = new Set<string>(BASELINE_CHILDREN)
    if (existsSync(baselineDir)) {
      for (const filename of readdirSync(baselineDir)) {
        if (filename.endsWith('.md') && filename !== 'README.md') knownFiles.add(filename)
      }
    }

    const childInputs = Array.from(knownFiles)
      .sort()
      .map((filename) => {
        const filePath = join(baselineDir, filename)
        if (!existsSync(filePath)) {
          return {
            baselineMtimeMs: null,
            raw: '',
            exists: false,
            filename,
          }
        }
        const raw = readCachedTextFile(filePath)
        const baselineMtimeMs = statSync(filePath).mtimeMs
        return { baselineMtimeMs, exists: true, filename, raw }
      })

    const coveredPatterns = Array.from(
      new Set(
        childInputs
          .filter((child) => child.exists)
          .flatMap((child) => BASELINE_COVERAGE_MAP[child.filename] ?? [])
      )
    )
    const oldestBaselineMtimeMs = Math.min(
      ...childInputs
        .map((child) => child.baselineMtimeMs)
        .filter((mtimeMs): mtimeMs is number => typeof mtimeMs === 'number')
    )
    const allChangedFiles =
      Number.isFinite(oldestBaselineMtimeMs) && coveredPatterns.length > 0
        ? changedFilesSince(workspacePath, oldestBaselineMtimeMs, coveredPatterns)
        : []

    parsed.children = childInputs.map((child) => {
      const filename = child.filename
      if (!child.exists) {
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
      const raw = child.raw
      const baselineMtimeMs = child.baselineMtimeMs ?? 0
      const isStub = isStubContent(raw)
      const patterns = BASELINE_COVERAGE_MAP[filename] ?? []
      const changedFiles =
        allChangedFiles === null
          ? null
          : allChangedFiles
              .filter((file) => file.timestampMs >= baselineMtimeMs)
              .filter((file) => matchesAnyPattern(file.path, patterns))
              .map((file) => file.path)
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
