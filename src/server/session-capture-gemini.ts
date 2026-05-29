import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { captureSessionIdWithCoordinator } from './claude-session-coordinator.js'

// 身份判别符：用 session 文件内容里是否含指定标记串来区分“这个 session 属于哪个 agent”，
// 防止同 workspace 同 cwd 下多个 gemini agent 互相抢到对方的 session id。
interface GeminiSessionCaptureDiscriminator {
  contentIncludes?: string | readonly string[]
}

const includesAny = (content: string, needles: string | readonly string[]) => {
  const normalizedNeedles = Array.isArray(needles) ? needles : [needles]
  return normalizedNeedles.some((needle) => content.includes(needle))
}

const GEMINI_SESSION_FILE = /^session-.*\.json$/i

const getDefaultGeminiHome = () => process.env.HIVE_GEMINI_HOME ?? join(homedir(), '.gemini')

const expandHome = (path: string) =>
  path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(2)) : path

export const getGeminiHome = (pattern?: string) => {
  if (!pattern) return getDefaultGeminiHome()
  const markerIndex = pattern.indexOf('/tmp/')
  if (markerIndex === -1) return getDefaultGeminiHome()
  const rawRoot = pattern.slice(0, markerIndex)
  if (rawRoot === '~/.gemini' || rawRoot === '~/.gemini/') return getDefaultGeminiHome()
  const root = expandHome(rawRoot)
  return root || getDefaultGeminiHome()
}

const readProjectRoot = (projectDir: string) => {
  try {
    return readFileSync(join(projectDir, '.project_root'), 'utf8').trim()
  } catch {
    return null
  }
}

const parseGeminiSessionId = (filePath: string) => {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
  if (!parsed || typeof parsed !== 'object') return null
  return 'sessionId' in parsed && typeof parsed.sessionId === 'string' ? parsed.sessionId : null
}

// 同时返回 session id 与其源文件路径，供身份判别符按内容过滤时定位文件。
const listSessionEntries = (cwd: string, geminiHome = getDefaultGeminiHome()) => {
  const tmpRoot = join(geminiHome, 'tmp')
  try {
    return readdirSync(tmpRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const projectDir = join(tmpRoot, entry.name)
        if (readProjectRoot(projectDir) !== cwd) return []
        const chatsDir = join(projectDir, 'chats')
        try {
          return readdirSync(chatsDir, { withFileTypes: true }).flatMap((chat) => {
            if (!chat.isFile() || !GEMINI_SESSION_FILE.test(chat.name)) return []
            const filePath = join(chatsDir, chat.name)
            try {
              const sessionId = parseGeminiSessionId(filePath)
              return sessionId ? [{ filePath, id: sessionId }] : []
            } catch {
              return []
            }
          })
        } catch {
          return []
        }
      })
      .sort((left, right) => left.id.localeCompare(right.id))
  } catch {
    return []
  }
}

const listSessionIds = (cwd: string, geminiHome = getDefaultGeminiHome()) =>
  listSessionEntries(cwd, geminiHome).map((entry) => entry.id)

// gemini session 文件名不等于 session id（id 在 json 字段里），所以要先按 id 找到源文件，
// 再整文件读内容判断是否含本 agent 的判别符标记，仿 session-capture-claude.ts 的 sessionFileContainsAny。
const sessionFileContainsAny = (
  cwd: string,
  geminiHome: string,
  sessionId: string,
  contentIncludes: string | readonly string[]
) => {
  const entry = listSessionEntries(cwd, geminiHome).find((candidate) => candidate.id === sessionId)
  if (!entry) return false
  try {
    return includesAny(readFileSync(entry.filePath, 'utf8'), contentIncludes)
  } catch {
    return false
  }
}

export const hasGeminiSession = (
  cwd: string,
  sessionId: string,
  pattern?: string,
  discriminator: GeminiSessionCaptureDiscriminator = {}
) => {
  const geminiHome = getGeminiHome(pattern)
  if (!listSessionIds(cwd, geminiHome).includes(sessionId)) return false
  return discriminator.contentIncludes
    ? sessionFileContainsAny(cwd, geminiHome, sessionId, discriminator.contentIncludes)
    : true
}

export const snapshotGeminiSessionIds = (cwd: string, geminiHome = getDefaultGeminiHome()) =>
  new Set(listSessionIds(cwd, geminiHome))

export const captureGeminiSessionId = async (
  cwd: string,
  knownSessionIds: Set<string>,
  onCapture: (sessionId: string) => void,
  timeoutMs = 5000,
  intervalMs = 100,
  geminiHome = getDefaultGeminiHome(),
  discriminator: GeminiSessionCaptureDiscriminator = {}
) => {
  const contentIncludes = discriminator.contentIncludes
  await captureSessionIdWithCoordinator({
    intervalMs,
    knownSessionIds,
    listSessionIds: () => listSessionIds(cwd, geminiHome),
    onCapture,
    projectKey: join(geminiHome, 'tmp', cwd),
    timeoutMs,
    ...(contentIncludes
      ? {
          matchesSessionId: (sessionId: string) =>
            sessionFileContainsAny(cwd, geminiHome, sessionId, contentIncludes),
        }
      : {}),
  })
}

export const geminiSessionStoreExists = (geminiHome = getDefaultGeminiHome()) =>
  existsSync(join(geminiHome, 'tmp'))
