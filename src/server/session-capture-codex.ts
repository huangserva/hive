import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { captureSessionIdWithCoordinator } from './claude-session-coordinator.js'

// 身份判别符：用 session 文件内容里是否含指定标记串来区分“这个 session 属于哪个 agent”，
// 防止同 workspace 同 cwd 下多个 codex agent 互相抢到对方的 session id。
interface CodexSessionCaptureDiscriminator {
  contentIncludes?: string | readonly string[]
}

const includesAny = (content: string, needles: string | readonly string[]) => {
  const normalizedNeedles = Array.isArray(needles) ? needles : [needles]
  return normalizedNeedles.some((needle) => content.includes(needle))
}

const CODEX_SESSION_FILE = /^rollout-.*\.jsonl$/i
const CODEX_HEADER_READ_CHUNK_BYTES = 4096

const getDefaultCodexHome = () => process.env.CODEX_HOME ?? join(homedir(), '.codex')

const expandHome = (path: string) =>
  path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(2)) : path

export const getCodexHome = (pattern?: string) => {
  if (!pattern) return getDefaultCodexHome()
  const markerIndex = pattern.indexOf('/sessions/')
  if (markerIndex === -1) return getDefaultCodexHome()
  const rawRoot = pattern.slice(0, markerIndex)
  if (rawRoot === '~/.codex' || rawRoot === '~/.codex/') return getDefaultCodexHome()
  const root = expandHome(rawRoot)
  return root || getDefaultCodexHome()
}

const walkSessionFiles = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return walkSessionFiles(path)
      return entry.isFile() && CODEX_SESSION_FILE.test(entry.name) ? [path] : []
    })
  } catch {
    return []
  }
}

// 默认不限制首行字节数：codex session_meta 首行可能 >64KB，旧的硬上限会让这类 session 被静默跳过、
// 永远捕获不到（bug C1）。这里读到首个换行（或 EOF）为止，正常 JSONL 第一行后即有换行不会读全文。
// maxBytes 参数仍保留，供需要有界读取的调用方（及测试）显式传入。
export const readCodexSessionFirstLine = (
  filePath: string,
  maxBytes = Number.POSITIVE_INFINITY
): string | null => {
  const fd = openSync(filePath, 'r')
  try {
    const chunks: Buffer[] = []
    let totalBytes = 0
    let position = 0
    let reachedLineEnd = false

    while (totalBytes < maxBytes) {
      const bytesToRead = Math.min(CODEX_HEADER_READ_CHUNK_BYTES, maxBytes - totalBytes)
      const buffer = Buffer.allocUnsafe(bytesToRead)
      const bytesRead = readSync(fd, buffer, 0, bytesToRead, position)
      if (bytesRead === 0) {
        reachedLineEnd = true
        break
      }

      const slice = buffer.subarray(0, bytesRead)
      const newlineIndex = slice.indexOf(0x0a)
      if (newlineIndex >= 0) {
        chunks.push(slice.subarray(0, newlineIndex))
        reachedLineEnd = true
        break
      }

      chunks.push(slice)
      totalBytes += bytesRead
      position += bytesRead
    }

    if (!reachedLineEnd) return null
    return Buffer.concat(chunks).toString('utf8').replace(/\r$/, '')
  } finally {
    closeSync(fd)
  }
}

const parseCodexSession = (filePath: string) => {
  const firstLine = readCodexSessionFirstLine(filePath) ?? ''
  const parsed = JSON.parse(firstLine) as unknown
  if (!parsed || typeof parsed !== 'object' || !('payload' in parsed)) return null
  const payload = parsed.payload
  if (!payload || typeof payload !== 'object') return null
  const id = 'id' in payload && typeof payload.id === 'string' ? payload.id : null
  const cwd = 'cwd' in payload && typeof payload.cwd === 'string' ? payload.cwd : null
  return id && cwd ? { cwd, id } : null
}

// 同时返回 session id 与其源文件路径，供身份判别符按内容过滤时定位文件。
const listSessionEntries = (cwd: string, codexHome = getDefaultCodexHome()) => {
  const sessionsRoot = join(codexHome, 'sessions')
  return walkSessionFiles(sessionsRoot)
    .flatMap((filePath) => {
      try {
        const session = parseCodexSession(filePath)
        return session?.cwd === cwd ? [{ filePath, id: session.id }] : []
      } catch {
        return []
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id))
}

const listSessionIds = (cwd: string, codexHome = getDefaultCodexHome()) =>
  listSessionEntries(cwd, codexHome).map((entry) => entry.id)

// codex rollout 文件名不等于 session id（id 在 payload 里），所以要先按 id 找到源文件，
// 再整文件读内容判断是否含本 agent 的判别符标记，仿 session-capture-claude.ts 的 sessionFileContainsAny。
const sessionFileContainsAny = (
  cwd: string,
  codexHome: string,
  sessionId: string,
  contentIncludes: string | readonly string[]
) => {
  const entry = listSessionEntries(cwd, codexHome).find((candidate) => candidate.id === sessionId)
  if (!entry) return false
  try {
    return includesAny(readFileSync(entry.filePath, 'utf8'), contentIncludes)
  } catch {
    return false
  }
}

export const hasCodexSession = (
  cwd: string,
  sessionId: string,
  pattern?: string,
  discriminator: CodexSessionCaptureDiscriminator = {}
) => {
  const codexHome = getCodexHome(pattern)
  if (!listSessionIds(cwd, codexHome).includes(sessionId)) return false
  return discriminator.contentIncludes
    ? sessionFileContainsAny(cwd, codexHome, sessionId, discriminator.contentIncludes)
    : true
}

export const snapshotCodexSessionIds = (cwd: string, codexHome = getDefaultCodexHome()) =>
  new Set(listSessionIds(cwd, codexHome))

export const captureCodexSessionId = async (
  cwd: string,
  knownSessionIds: Set<string>,
  onCapture: (sessionId: string) => void,
  timeoutMs = 5000,
  intervalMs = 100,
  codexHome = getDefaultCodexHome(),
  discriminator: CodexSessionCaptureDiscriminator = {}
) => {
  const contentIncludes = discriminator.contentIncludes
  await captureSessionIdWithCoordinator({
    intervalMs,
    knownSessionIds,
    listSessionIds: () => listSessionIds(cwd, codexHome),
    onCapture,
    projectKey: join(codexHome, 'sessions', cwd),
    timeoutMs,
    ...(contentIncludes
      ? {
          matchesSessionId: (sessionId: string) =>
            sessionFileContainsAny(cwd, codexHome, sessionId, contentIncludes),
        }
      : {}),
  })
}

export const codexSessionStoreExists = (codexHome = getDefaultCodexHome()) =>
  existsSync(join(codexHome, 'sessions'))
