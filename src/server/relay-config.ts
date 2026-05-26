import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  decodeBase64,
  encodeBase64,
  generateKeyPair,
  type KeyPair,
} from '../../packages/relay-crypto/src/index.js'
import type { RelayConfig } from './relay-connector.js'

export type LoadedRelayConfig = RelayConfig | { enabled: false }

interface LoadRelayConfigOptions {
  dataDir?: string
}

interface RelayConfigFile {
  enabled?: boolean
  relay_auth_token?: unknown
  relay_url?: unknown
  room_id?: unknown
  runtime_id?: unknown
}

interface RelayKeypairFile {
  publicKey: string
  secretKey: string
}

const defaultDataDir = () => process.env.HIVE_DATA_DIR ?? join(homedir(), '.config', 'hive')

const readJsonFile = async <T>(path: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

const requireString = (value: unknown, fieldName: string) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`relay config ${fieldName} is required`)
  }
  return value.trim()
}

const readOrCreateKeypair = async (path: string): Promise<KeyPair> => {
  const existing = await readJsonFile<RelayKeypairFile>(path)
  if (existing) {
    return {
      publicKey: decodeBase64(existing.publicKey),
      secretKey: decodeBase64(existing.secretKey),
    }
  }

  const generated = generateKeyPair()
  await writeFile(
    path,
    JSON.stringify(
      {
        publicKey: encodeBase64(generated.publicKey),
        secretKey: encodeBase64(generated.secretKey),
      },
      null,
      2
    )
  )
  return generated
}

export const loadRelayConfig = async (
  options: LoadRelayConfigOptions = {}
): Promise<LoadedRelayConfig> => {
  const dataDir = options.dataDir ?? defaultDataDir()
  const config = await readJsonFile<RelayConfigFile>(join(dataDir, 'relay.json'))
  if (!config || config.enabled === false) {
    return { enabled: false }
  }

  await mkdir(dataDir, { recursive: true })
  return {
    daemon_keypair: await readOrCreateKeypair(join(dataDir, 'relay-keypair.json')),
    enabled: true,
    relay_auth_token: requireString(config.relay_auth_token, 'relay_auth_token'),
    relay_url: requireString(config.relay_url, 'relay_url'),
    room_id: requireString(config.room_id, 'room_id'),
    runtime_id: requireString(config.runtime_id, 'runtime_id'),
  }
}
