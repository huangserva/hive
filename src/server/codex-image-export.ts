import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const CODEX_ROLLOUT_FILE = /^rollout-.*\.jsonl$/i
const PNG_MAGIC_HEX = '89504e470d0a1a0a'

export interface CodexImageExportResult {
  bytes: number
  imageEventLine: number
  outPath: string
  sourcePath: string
}

const walkRolloutFiles = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return walkRolloutFiles(path)
      return entry.isFile() && CODEX_ROLLOUT_FILE.test(entry.name) ? [path] : []
    })
  } catch {
    return []
  }
}

const listRolloutFilesNewestFirst = (sessionRoot: string) =>
  walkRolloutFiles(sessionRoot).sort((left, right) => {
    const rightMtime = statSync(right).mtimeMs
    const leftMtime = statSync(left).mtimeMs
    return rightMtime - leftMtime
  })

const decodePngResult = (value: unknown): Buffer | null => {
  if (typeof value !== 'string' || value.length < 16) return null
  try {
    const decoded = Buffer.from(value, 'base64')
    return decoded.subarray(0, 8).toString('hex') === PNG_MAGIC_HEX ? decoded : null
  } catch {
    return null
  }
}

const findImageResultInRollout = (filePath: string) => {
  const lines = readFileSync(filePath, 'utf8').split(/\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim()
    if (!line?.includes('image_generation_end')) continue
    try {
      const parsed = JSON.parse(line) as { payload?: { result?: unknown; type?: unknown } }
      const payload = parsed.payload
      if (payload?.type !== 'image_generation_end') continue
      const decoded = decodePngResult(payload.result)
      if (!decoded) continue
      return { bytes: decoded, line: index + 1 }
    } catch {
      // Ignore malformed rollout lines; older Codex logs may contain partial writes.
    }
  }
  return null
}

export const exportLatestCodexImageFromSessionRoot = (options: {
  outPath: string
  sessionRoot: string
}): CodexImageExportResult => {
  for (const rolloutPath of listRolloutFilesNewestFirst(options.sessionRoot)) {
    const found = findImageResultInRollout(rolloutPath)
    if (!found) continue
    mkdirSync(dirname(options.outPath), { recursive: true })
    writeFileSync(options.outPath, found.bytes)
    return {
      bytes: found.bytes.length,
      imageEventLine: found.line,
      outPath: options.outPath,
      sourcePath: rolloutPath,
    }
  }

  throw new Error(`No PNG image_generation_end result found under ${options.sessionRoot}`)
}
