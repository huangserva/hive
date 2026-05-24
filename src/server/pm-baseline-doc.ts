import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface BaselineFile {
  exists: boolean
  filename: string
  isStub: boolean
  size: number
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

const titleFromMarkdown = (content: string, fallback: string) =>
  /^#\s+(.+?)\s*$/m.exec(content)?.[1]?.trim() ?? fallback

const lineCount = (content: string) => (content ? content.split(/\r?\n/).length : 0)

const isStubContent = (content: string) => /待 AI 起草|\(待填\)|（待填）/.test(content)

export const parseBaselineDoc = (baselineDir: string): ParsedBaseline => {
  const parsed: ParsedBaseline = {
    children: [],
    parseError: null,
    readme: null,
    staleHint: null,
  }
  try {
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
            title: filename.replace(/\.md$/, ''),
          }
        }
        const raw = readFileSync(filePath, 'utf8')
        return {
          exists: true,
          filename,
          isStub: isStubContent(raw),
          size: lineCount(raw),
          title: titleFromMarkdown(raw, filename.replace(/\.md$/, '')),
        }
      })

    const missing = parsed.children.filter((child) => !child.exists).length
    const stubs = parsed.children.filter((child) => child.isStub).length
    if (missing > 0) parsed.staleHint = `${missing} baseline files missing`
    else if (stubs > 0) parsed.staleHint = `${stubs} baseline files still need drafting`
  } catch (error) {
    parsed.parseError = error instanceof Error ? error.message : String(error)
  }
  return parsed
}
