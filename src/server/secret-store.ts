import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const SECRET_ENV_KEYS = ['GLM_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const

export type SecretEnvKey = (typeof SECRET_ENV_KEYS)[number]

type SecretRecord = Partial<Record<SecretEnvKey, string>>

export interface SecretStore {
  get: (key: SecretEnvKey) => string | null
  listPresent: () => Record<SecretEnvKey, boolean>
  set: (key: SecretEnvKey, value: string) => void
}

export const isSecretEnvKey = (value: unknown): value is SecretEnvKey =>
  typeof value === 'string' && (SECRET_ENV_KEYS as readonly string[]).includes(value)

const emptyPresent = (): Record<SecretEnvKey, boolean> => ({
  ANTHROPIC_API_KEY: false,
  ANTHROPIC_AUTH_TOKEN: false,
  GLM_API_KEY: false,
})

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
    listPresent: () => ({
      ANTHROPIC_API_KEY: typeof record.ANTHROPIC_API_KEY === 'string',
      ANTHROPIC_AUTH_TOKEN: typeof record.ANTHROPIC_AUTH_TOKEN === 'string',
      GLM_API_KEY: typeof record.GLM_API_KEY === 'string',
    }),
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
