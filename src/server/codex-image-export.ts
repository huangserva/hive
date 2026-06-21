import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

const CODEX_ROLLOUT_FILE = /^rollout-.*\.jsonl$/i
const PNG_MAGIC_HEX = '89504e470d0a1a0a'
const CODEX_IMAGE_ROLLOUT_READ_CHUNK_BYTES = 64 * 1024
const CODEX_IMAGE_ROLLOUT_MAX_LINE_BYTES = 64 * 1024 * 1024

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

const parseImageCandidateLine = (
  line: string,
  filePath: string,
  fallbackTimestamp: number,
  lineNumber: number
): CodexImageCandidate | null => {
  const trimmed = line.trim()
  if (!trimmed.includes('image_generation_end')) return null
  try {
    const parsed = JSON.parse(trimmed) as {
      payload?: { result?: unknown; type?: unknown }
      timestamp?: unknown
    }
    const payload = parsed.payload
    if (payload?.type !== 'image_generation_end') return null
    const decoded = decodePngResult(payload.result)
    if (!decoded) return null
    return {
      bytes: decoded,
      imageEventLine: lineNumber,
      sourcePath: filePath,
      timestampMs: parseTimestampMs(parsed.timestamp, fallbackTimestamp),
    }
  } catch {
    // Ignore malformed rollout lines; older Codex logs may contain partial writes.
    return null
  }
}

const findLatestImageResultInRollout = (filePath: string): CodexImageCandidate | null => {
  const fallbackTimestamp = statSync(filePath).mtimeMs
  const fd = openSync(filePath, 'r')
  try {
    let best: CodexImageCandidate | null = null
    let lineNumber = 1
    let position = 0
    let lineChunks: Buffer[] = []
    let lineBytes = 0
    let skippingOversizedLine = false

    const processLine = () => {
      if (!skippingOversizedLine && lineBytes > 0) {
        const candidate = parseImageCandidateLine(
          Buffer.concat(lineChunks, lineBytes).toString('utf8').replace(/\r$/, ''),
          filePath,
          fallbackTimestamp,
          lineNumber
        )
        if (candidate && (!best || candidate.timestampMs > best.timestampMs)) best = candidate
      }
      lineNumber += 1
      lineChunks = []
      lineBytes = 0
      skippingOversizedLine = false
    }

    while (true) {
      const buffer = Buffer.allocUnsafe(CODEX_IMAGE_ROLLOUT_READ_CHUNK_BYTES)
      const bytesRead = readSync(fd, buffer, 0, CODEX_IMAGE_ROLLOUT_READ_CHUNK_BYTES, position)
      if (bytesRead === 0) break
      position += bytesRead
      let segmentStart = 0
      const chunk = buffer.subarray(0, bytesRead)
      for (let index = 0; index < chunk.length; index += 1) {
        if (chunk[index] !== 0x0a) continue
        const segment = chunk.subarray(segmentStart, index)
        if (!skippingOversizedLine) {
          lineBytes += segment.length
          if (lineBytes > CODEX_IMAGE_ROLLOUT_MAX_LINE_BYTES) {
            lineChunks = []
            lineBytes = 0
            skippingOversizedLine = true
          } else if (segment.length > 0) {
            lineChunks.push(segment)
          }
        }
        processLine()
        segmentStart = index + 1
      }
      const rest = chunk.subarray(segmentStart)
      if (!skippingOversizedLine) {
        lineBytes += rest.length
        if (lineBytes > CODEX_IMAGE_ROLLOUT_MAX_LINE_BYTES) {
          lineChunks = []
          lineBytes = 0
          skippingOversizedLine = true
        } else if (rest.length > 0) {
          lineChunks.push(rest)
        }
      }
    }

    if (lineBytes > 0 || skippingOversizedLine) processLine()
    return best
  } finally {
    closeSync(fd)
  }
}

export const exportLatestCodexImageFromSessionRoot = (options: {
  outPath: string
  sessionRoot: string
}): CodexImageExportResult => {
  let found: CodexImageCandidate | null = null
  for (const rolloutPath of listRolloutFiles(options.sessionRoot)) {
    const candidate = findLatestImageResultInRollout(rolloutPath)
    if (candidate && (!found || candidate.timestampMs > found.timestampMs)) found = candidate
  }
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
