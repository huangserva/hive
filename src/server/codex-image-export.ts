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

interface CodexImageCandidate {
  bytes: Buffer
  imageEventLine: number
  sourcePath: string
  timestampMs: number
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

const listRolloutFiles = (sessionRoot: string) => walkRolloutFiles(sessionRoot)

const decodePngResult = (value: unknown): Buffer | null => {
  if (typeof value !== 'string' || value.length < 16) return null
  try {
    const decoded = Buffer.from(value, 'base64')
    return decoded.subarray(0, 8).toString('hex') === PNG_MAGIC_HEX ? decoded : null
  } catch {
    return null
  }
}

const parseTimestampMs = (value: unknown, fallback: number) => {
  if (typeof value !== 'string') return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const findImageResultsInRollout = (filePath: string): CodexImageCandidate[] => {
  const fallbackTimestamp = statSync(filePath).mtimeMs
  const lines = readFileSync(filePath, 'utf8').split(/\n/)
  const results: CodexImageCandidate[] = []
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim()
    if (!line?.includes('image_generation_end')) continue
    try {
      const parsed = JSON.parse(line) as {
        payload?: { result?: unknown; type?: unknown }
        timestamp?: unknown
      }
      const payload = parsed.payload
      if (payload?.type !== 'image_generation_end') continue
      const decoded = decodePngResult(payload.result)
      if (!decoded) continue
      results.push({
        bytes: decoded,
        imageEventLine: index + 1,
        sourcePath: filePath,
        timestampMs: parseTimestampMs(parsed.timestamp, fallbackTimestamp),
      })
    } catch {
      // Ignore malformed rollout lines; older Codex logs may contain partial writes.
    }
  }
  return results
}

export const exportLatestCodexImageFromSessionRoot = (options: {
  outPath: string
  sessionRoot: string
}): CodexImageExportResult => {
  const found = listRolloutFiles(options.sessionRoot)
    .flatMap((rolloutPath) => findImageResultsInRollout(rolloutPath))
    .sort((left, right) => right.timestampMs - left.timestampMs)[0]
  if (found) {
    mkdirSync(dirname(options.outPath), { recursive: true })
    writeFileSync(options.outPath, found.bytes)
    return {
      bytes: found.bytes.length,
      imageEventLine: found.imageEventLine,
      outPath: options.outPath,
      sourcePath: found.sourcePath,
    }
  }

  throw new Error(`No PNG image_generation_end result found under ${options.sessionRoot}`)
}
