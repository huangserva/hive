import { createSecretStore, SECRET_ENV_KEYS } from './secret-store.js'

export const loadSecretValues = (dataDir?: string): string[] => {
  const store = createSecretStore(dataDir)
  return SECRET_ENV_KEYS.flatMap((key) => [store.get(key), process.env[key]]).filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  )
}

export const redactText = (text: string, secretValues: string[]) => {
  let redacted = text
  for (const secret of [...new Set(secretValues)].sort(
    (left, right) => right.length - left.length
  )) {
    redacted = redacted.split(secret).join('[REDACTED]')
  }
  return redacted
}

export const redactObject = <T>(value: T, secretValues: string[]): T => {
  if (secretValues.length === 0) return value
  if (typeof value === 'string') return redactText(value, secretValues) as T
  if (Array.isArray(value)) return value.map((item) => redactObject(item, secretValues)) as T
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, redactObject(entry, secretValues)])
  ) as T
}
