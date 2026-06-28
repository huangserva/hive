import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const SECRET_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'DEEPSEEK_API_KEY',
  'FEISHU_APP_SECRET',
  'GEMINI_API_KEY',
  'GLM_API_KEY',
  'GOOGLE_API_KEY',
  'GROQ_API_KEY',
  'HIVE_WEBRTC_ICE_SERVERS_JSON',
  'MISTRAL_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'RELAY_AUTH_TOKEN',
  'XAI_API_KEY',
] as const

export type SecretEnvKey = (typeof SECRET_ENV_KEYS)[number]

type SecretRecord = Partial<Record<SecretEnvKey, string>>

export interface SecretStore {
  get: (key: SecretEnvKey) => string | null
  listPresent: () => Record<SecretEnvKey, boolean>
  set: (key: SecretEnvKey, value: string) => void
}

export const isSecretEnvKey = (value: unknown): value is SecretEnvKey =>
  typeof value === 'string' && (SECRET_ENV_KEYS as readonly string[]).includes(value)

const emptyPresent = (): Record<SecretEnvKey, boolean> =>
  SECRET_ENV_KEYS.reduce(
    (present, key) => {
      present[key] = false
      return present
    },
    {} as Record<SecretEnvKey, boolean>
  )

const isSecretRecord = (value: unknown): value is SecretRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value).every(
    ([key, recordValue]) => isSecretEnvKey(key) && typeof recordValue === 'string'
  )
}

const createInMemorySecretStore = (): SecretStore => {
  const record: SecretRecord = {}
  return {
    get: (key) => record[key] ?? null,
    listPresent: () =>
      SECRET_ENV_KEYS.reduce((present, key) => {
        present[key] = typeof record[key] === 'string'
        return present
      }, emptyPresent()),
    set: (key, value) => {
      record[key] = value
    },
  }
}

export const createSecretStore = (dataDir?: string): SecretStore => {
  if (!dataDir) return createInMemorySecretStore()

  const secretsDir = join(dataDir, 'secrets')
  const credentialsPath = join(secretsDir, 'credentials')

  const ensureStorage = () => {
    mkdirSync(secretsDir, { mode: 0o700, recursive: true })
    chmodSync(secretsDir, 0o700)
  }

  const read = (): SecretRecord => {
    try {
      const parsed = JSON.parse(readFileSync(credentialsPath, 'utf8')) as unknown
      return isSecretRecord(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  const write = (record: SecretRecord) => {
    ensureStorage()
    const tempPath = join(dirname(credentialsPath), `.credentials-${process.pid}.tmp`)
    writeFileSync(tempPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
    chmodSync(tempPath, 0o600)
    renameSync(tempPath, credentialsPath)
    chmodSync(credentialsPath, 0o600)
  }

  return {
    get: (key) => read()[key] ?? null,
    listPresent: () => {
      const record = read()
      return SECRET_ENV_KEYS.reduce((present, key) => {
        present[key] = typeof record[key] === 'string'
        return present
      }, emptyPresent())
    },
    set: (key, value) => {
      write({ ...read(), [key]: value })
    },
  }
}

export const injectSecretsIntoEnv = ({
  dataDir,
  env = process.env,
}: {
  dataDir?: string | undefined
  env?: NodeJS.ProcessEnv
}) => {
  const store = createSecretStore(dataDir)
  const injected: SecretEnvKey[] = []
  for (const key of SECRET_ENV_KEYS) {
    if (env[key] !== undefined) continue
    const value = store.get(key)
    if (value === null) continue
    env[key] = value
    injected.push(key)
  }
  return injected
}
