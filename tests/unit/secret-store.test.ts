import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import {
  createSecretStore,
  injectSecretsIntoEnv,
  SECRET_ENV_KEYS,
} from '../../src/server/secret-store.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const setupDataDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-secret-store-'))
  tempDirs.push(dir)
  return dir
}

const mode = (path: string) => statSync(path).mode & 0o777

describe('secret store', () => {
  test('stores credentials in a restricted file and returns present flags without listing values', () => {
    const dataDir = setupDataDir()
    const store = createSecretStore(dataDir)

    store.set('GLM_API_KEY', 'glm-secret-value')

    expect(store.get('GLM_API_KEY')).toBe('glm-secret-value')
    const present = store.listPresent()
    expect(present.GLM_API_KEY).toBe(true)
    expect(present.ANTHROPIC_API_KEY).toBe(false)
    expect(present.OPENAI_API_KEY).toBe(false)
    expect(Object.values(present)).not.toContain('glm-secret-value')
    expect(mode(join(dataDir, 'secrets'))).toBe(0o700)
    expect(mode(join(dataDir, 'secrets', 'credentials'))).toBe(0o600)
  })

  test('does not throw when credentials file is missing or damaged', () => {
    const dataDir = setupDataDir()
    const store = createSecretStore(dataDir)

    expect(store.get('GLM_API_KEY')).toBeNull()
    expect(store.listPresent().GLM_API_KEY).toBe(false)

    mkdirSync(join(dataDir, 'secrets'), { mode: 0o700, recursive: true })
    writeFileSync(join(dataDir, 'secrets', 'credentials'), '{not json', { mode: 0o600 })

    expect(store.get('GLM_API_KEY')).toBeNull()
    expect(store.listPresent().GLM_API_KEY).toBe(false)
  })

  test('injects only missing env keys and never overwrites explicit env values', () => {
    const dataDir = setupDataDir()
    const store = createSecretStore(dataDir)
    store.set('GLM_API_KEY', 'from-secret-store')
    store.set('ANTHROPIC_API_KEY', 'anthropic-secret')
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      GLM_API_KEY: 'explicit-env-wins',
      PATH: '/usr/bin',
    }

    const injected = injectSecretsIntoEnv({ dataDir, env })

    expect(injected).toEqual(['ANTHROPIC_API_KEY'])
    expect(env.GLM_API_KEY).toBe('explicit-env-wins')
    expect(env.ANTHROPIC_API_KEY).toBe('anthropic-secret')
    expect(Object.keys(env).sort()).toEqual([
      'ANTHROPIC_API_KEY',
      'GLM_API_KEY',
      'NODE_ENV',
      'PATH',
    ])
  })

  test('supports the provider and runtime credential env vars used by diagnostics redaction', () => {
    expect([...SECRET_ENV_KEYS].sort()).toEqual([
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
    ])
  })
})
