import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface FeishuCredentials {
  appId: string
  appSecret: string
}

export interface LoadFeishuCredentialsOptions {
  dataDir: string
}

export class FeishuCredentialsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeishuCredentialsError'
  }
}

const validateCredentials = (raw: unknown, source: string): FeishuCredentials => {
  if (!raw || typeof raw !== 'object') {
    throw new FeishuCredentialsError(`${source}: expected JSON object`)
  }
  const record = raw as Record<string, unknown>
  const appId = record.app_id ?? record.appId
  const appSecret = record.app_secret ?? record.appSecret
  if (typeof appId !== 'string' || !appId.trim()) {
    throw new FeishuCredentialsError(`${source}: app_id missing or empty`)
  }
  if (typeof appSecret !== 'string' || !appSecret.trim()) {
    throw new FeishuCredentialsError(`${source}: app_secret missing or empty`)
  }
  return { appId: appId.trim(), appSecret: appSecret.trim() }
}

export const loadFeishuCredentials = ({
  dataDir,
}: LoadFeishuCredentialsOptions): FeishuCredentials | null => {
  const file = join(dataDir, 'feishu.json')
  let body: string
  try {
    body = readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new FeishuCredentialsError(`failed to read ${file}: ${(error as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (error) {
    throw new FeishuCredentialsError(`${file}: invalid JSON — ${(error as Error).message}`)
  }
  return validateCredentials(parsed, file)
}
