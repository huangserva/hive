import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'

import { captureSessionIdWithCoordinator } from './claude-session-coordinator.js'

// 身份判别符：用 session 的 part 内容里是否含指定标记串来区分“这个 session 属于哪个 agent”，
// 防止同 workspace 同 cwd 下多个 opencode agent 互相抢到对方的 session id（bug B3）。
interface OpenCodeSessionCaptureDiscriminator {
  contentIncludes?: string | readonly string[]
}

const includesAny = (content: string, needles: string | readonly string[]) => {
  const normalizedNeedles = Array.isArray(needles) ? needles : [needles]
  return normalizedNeedles.some((needle) => content.includes(needle))
}

const expandHome = (path: string) =>
  path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(2)) : path

const getDefaultOpenCodeDbPath = () =>
  process.env.HIVE_OPENCODE_DB_PATH ??
  join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'opencode', 'opencode.db')

export const getOpenCodeDbPath = (pattern?: string) =>
  pattern === '~/.local/share/opencode/opencode.db' || !pattern
    ? getDefaultOpenCodeDbPath()
    : expandHome(pattern)

const listSessionIds = (cwd: string, dbPath = getDefaultOpenCodeDbPath()) => {
  if (!existsSync(dbPath)) return []
  let db: Database.Database | undefined
  try {
    db = new Database(dbPath, { fileMustExist: true, readonly: true })
    return (
      db
        .prepare(
          `SELECT id FROM session
           WHERE directory = ? AND time_archived IS NULL
           ORDER BY rowid ASC`
        )
        .all(cwd) as Array<{ id: string }>
    ).map((row) => row.id)
  } catch {
    return []
  } finally {
    db?.close()
  }
}

// 读取某 session 的所有 part.data（opencode 把对话内容存在 part 表），判断是否含本 agent 的判别符标记。
// binding marker 会出现在启动说明对应的 text part 里，按 session_id 过滤后做 includesAny 即可区分身份。
const sessionContainsAny = (
  dbPath: string,
  sessionId: string,
  contentIncludes: string | readonly string[]
) => {
  if (!existsSync(dbPath)) return false
  let db: Database.Database | undefined
  try {
    db = new Database(dbPath, { fileMustExist: true, readonly: true })
    const rows = db.prepare('SELECT data FROM part WHERE session_id = ?').all(sessionId) as Array<{
      data: string
    }>
    return rows.some((row) => includesAny(row.data, contentIncludes))
  } catch {
    return false
  } finally {
    db?.close()
  }
}

export const hasOpenCodeSession = (
  cwd: string,
  sessionId: string,
  pattern?: string,
  discriminator: OpenCodeSessionCaptureDiscriminator = {}
) => {
  const dbPath = getOpenCodeDbPath(pattern)
  if (!listSessionIds(cwd, dbPath).includes(sessionId)) return false
  return discriminator.contentIncludes
    ? sessionContainsAny(dbPath, sessionId, discriminator.contentIncludes)
    : true
}

export const snapshotOpenCodeSessionIds = (cwd: string, dbPath = getDefaultOpenCodeDbPath()) =>
  new Set(listSessionIds(cwd, dbPath))

export const captureOpenCodeSessionId = async (
  cwd: string,
  knownSessionIds: Set<string>,
  onCapture: (sessionId: string) => void,
  timeoutMs = 5000,
  intervalMs = 100,
  dbPath = getDefaultOpenCodeDbPath(),
  discriminator: OpenCodeSessionCaptureDiscriminator = {}
) => {
  const contentIncludes = discriminator.contentIncludes
  await captureSessionIdWithCoordinator({
    intervalMs,
    knownSessionIds,
    listSessionIds: () => listSessionIds(cwd, dbPath),
    onCapture,
    projectKey: `${dbPath}:${cwd}`,
    timeoutMs,
    ...(contentIncludes
      ? {
          matchesSessionId: (sessionId: string) =>
            sessionContainsAny(dbPath, sessionId, contentIncludes),
        }
      : {}),
  })
}
