import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { deriveRoomAuthToken } from '../../packages/relay/src/keygen.js'
import {
  decodeBase64,
  encodeBase64,
  generateKeyPair,
  generateSigningKeyPair,
  type KeyPair,
} from '../../packages/relay-crypto/src/index.js'
import type { RelayConfig } from './relay-connector.js'

type EnabledRelayConfigV1 = RelayConfig & {
  enabled: true
  relay_protocol_version: 1
}

type EnabledRelayConfigV2 = RelayConfig & {
  daemon_signing_keypair: KeyPair
  enabled: true
  relay_protocol_version: 2
  room_auth_token: string
}

export type LoadedRelayConfig = EnabledRelayConfigV1 | EnabledRelayConfigV2 | { enabled: false }

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

const resolveRelayProtocolVersion = (env: NodeJS.ProcessEnv = process.env): 1 | 2 =>
  env.HIVE_RELAY_PROTOCOL_VERSION === '2' ? 2 : 1

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

const readOrCreateSigningKeypair = async (path: string): Promise<KeyPair> => {
  const existing = await readJsonFile<RelayKeypairFile>(path)
  if (existing) {
    return {
      publicKey: decodeBase64(existing.publicKey),
      secretKey: decodeBase64(existing.secretKey),
    }
  }

  const generated = generateSigningKeyPair()
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
  const relayAuthToken = requireString(config.relay_auth_token, 'relay_auth_token')
  const roomId = requireString(config.room_id, 'room_id')
  const baseConfig = {
    daemon_keypair: await readOrCreateKeypair(join(dataDir, 'relay-keypair.json')),
    enabled: true,
    relay_auth_token: relayAuthToken,
    relay_url: requireString(config.relay_url, 'relay_url'),
    room_id: roomId,
    runtime_id: requireString(config.runtime_id, 'runtime_id'),
  } satisfies Omit<EnabledRelayConfigV1, 'relay_protocol_version'>

  if (resolveRelayProtocolVersion() === 1) {
    return {
      ...baseConfig,
      relay_protocol_version: 1,
    }
  }

  return {
    ...baseConfig,
    daemon_signing_keypair: await readOrCreateSigningKeypair(
      join(dataDir, 'relay-signing-keypair.json')
    ),
    relay_protocol_version: 2,
    room_auth_token: deriveRoomAuthToken(relayAuthToken, roomId),
  }
}

export type RelayConnectionInfo =
  | { enabled: false }
  | {
      daemon_public_key: string
      enabled: true
      relay_auth_token: string
      relay_protocol_version: 1
      relay_url: string
      room_id: string
    }
  | {
      daemon_public_key: string
      daemon_signing_public_key: string
      enabled: true
      relay_auth_token: string
      relay_protocol_version: 2
      relay_url: string
      room_auth_token: string
      room_id: string
    }

/**
 * 给配对二维码 / Settings 用的 relay 连接信息。relay.json 未配置（或 enabled:false）时
 * 返回 { enabled:false }，此时 QR 只放 host/token，纯 LAN 行为不变。
 * 配置时返回 relay_url / room_id / relay_auth_token + daemon 公钥（base64）。
 * 注意：本 endpoint 受 UI token 保护、只在本机浏览器会话可读，QR 由 user 自己屏幕扫给自己手机，
 * 与设备 token 同信任级别；只暴露 daemon **公钥**，绝不含 daemon 私钥。
 */
export const loadRelayConnectionInfo = async (
  options: LoadRelayConfigOptions = {}
): Promise<RelayConnectionInfo> => {
  const config = await loadRelayConfig(options)
  if (!config.enabled) return { enabled: false }
  const baseInfo = {
    daemon_public_key: encodeBase64(config.daemon_keypair.publicKey),
    enabled: true,
    relay_auth_token: config.relay_auth_token,
    relay_url: config.relay_url,
    room_id: config.room_id,
  } satisfies Omit<RelayConnectionInfo & { enabled: true }, 'relay_protocol_version'>

  if (config.relay_protocol_version === 1) {
    return {
      ...baseInfo,
      relay_protocol_version: 1,
    }
  }

  return {
    ...baseInfo,
    daemon_signing_public_key: encodeBase64(config.daemon_signing_keypair.publicKey),
    relay_protocol_version: 2,
    room_auth_token: config.room_auth_token,
  }
}
