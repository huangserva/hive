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
    expect(store.listPresent()).toEqual({
      ANTHROPIC_API_KEY: false,
      ANTHROPIC_AUTH_TOKEN: false,
      GLM_API_KEY: true,
    })
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
    expect(Object.keys(env).sort()).toEqual(['ANTHROPIC_API_KEY', 'GLM_API_KEY', 'NODE_ENV', 'PATH'])
  })

  test('limits supported secret keys to runtime credential env vars', () => {
    expect([...SECRET_ENV_KEYS].sort()).toEqual([
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'GLM_API_KEY',
    ])
  })
})
