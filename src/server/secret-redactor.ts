import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createSecretStore, SECRET_ENV_KEYS } from './secret-store.js'

const SENSITIVE_ENV_KEY_PATTERN = /(?:_API_KEY$|_TOKEN$|_SECRET$|PASSWORD)/iu
const PROXY_ENV_KEYS = new Set(['ALL_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY'])
const SENSITIVE_CONFIG_KEY_PATTERN =
  /(?:api[_-]?key|auth[_-]?token|credential|password|secret|secretkey|token|username)$/iu
const CONFIG_SECRET_FILES = [
  'feishu.json',
  'relay.json',
  'relay-keypair.json',
  'relay-signing-keypair.json',
] as const

const pushSecret = (values: string[], value: unknown) => {
  if (typeof value !== 'string') return
  if (value.length === 0) return
  values.push(value)
}

const readJsonIfPresent = (path: string): unknown => {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return null
  }
}

const collectSensitiveJsonValues = (value: unknown, out: string[], keyHint = '') => {
  if (Array.isArray(value)) {
    for (const item of value) collectSensitiveJsonValues(item, out, keyHint)
    return
  }
  if (!value || typeof value !== 'object') {
    if (SENSITIVE_CONFIG_KEY_PATTERN.test(keyHint)) pushSecret(out, value)
    return
  }
  for (const [key, entry] of Object.entries(value)) {
    collectSensitiveJsonValues(entry, out, key)
  }
}

const collectProxyUserInfoValues = (value: string | undefined, out: string[]) => {
  if (!value) return
  try {
    const url = new URL(value)
    if (!url.username && !url.password) return
    const encodedUserInfo = value.match(/^[a-z][a-z0-9+.-]*:\/\/([^/@\s]+)@/iu)?.[1]
    pushSecret(out, encodedUserInfo)
    const decodedUserInfo = `${decodeURIComponent(url.username)}${
      url.password ? `:${decodeURIComponent(url.password)}` : ''
    }`
    pushSecret(out, decodedUserInfo)
    pushSecret(out, decodeURIComponent(url.username))
    pushSecret(out, decodeURIComponent(url.password))
  } catch {
    // Ignore malformed proxy URLs; generic text redaction still handles known values.
  }
}

const collectEnvSecretValues = (env: NodeJS.ProcessEnv, out: string[]) => {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (SECRET_ENV_KEYS.includes(key as (typeof SECRET_ENV_KEYS)[number])) pushSecret(out, value)
    if (SENSITIVE_ENV_KEY_PATTERN.test(key)) pushSecret(out, value)
    if (key === 'HIVE_WEBRTC_ICE_SERVERS_JSON') {
      collectSensitiveJsonValues(readJsonText(value), out)
    }
    if (PROXY_ENV_KEYS.has(key.toUpperCase())) collectProxyUserInfoValues(value, out)
  }
}

const readJsonText = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

const collectConfigSecretValues = (dataDir: string | undefined, out: string[]) => {
  if (!dataDir) return
  for (const file of CONFIG_SECRET_FILES) {
    collectSensitiveJsonValues(readJsonIfPresent(join(dataDir, file)), out)
  }
}

export const loadSecretValues = (dataDir?: string): string[] => {
  const store = createSecretStore(dataDir)
  const values: string[] = []
  for (const key of SECRET_ENV_KEYS) {
    pushSecret(values, store.get(key))
  }
  collectEnvSecretValues(process.env, values)
  collectConfigSecretValues(dataDir, values)
  return [...new Set(values)]
}

const redactUrlUserInfo = (text: string) =>
  text.replace(/\b(https?:\/\/)([^/@\s]+)@/giu, '$1[REDACTED]@')

export const redactText = (text: string, secretValues: string[]) => {
  let redacted = redactUrlUserInfo(text)
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
