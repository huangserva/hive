import type { RelayDeviceKeypair } from '../api/relay-device-keys'
import type { RelayTransportConfig } from '../api/relay-transport'
import type { RelayPairingInput } from './connection-qr'

// 持久化到 SecureStore 的 relay 配置 = relay-transport 所需的全套，减去每次连接才拼上的 device_token。
export type StoredRelayConfig = Omit<RelayTransportConfig, 'device_token'>

const LEGACY_RELAY_HOST = 'dmit.servasyy.com'
const CURRENT_RELAY_HOST = 'aliyun.servasyy.com'

export const normalizeRelayUrl = (relayUrl: string) => {
  try {
    const parsed = new URL(relayUrl)
    if (parsed.hostname.toLowerCase() !== LEGACY_RELAY_HOST) return relayUrl
    parsed.hostname = CURRENT_RELAY_HOST
    return parsed.toString()
  } catch {
    return relayUrl.replace(
      /(^[a-z][a-z0-9+.-]*:\/\/)(dmit\.servasyy\.com)(?=[:/?#]|$)/iu,
      `$1${CURRENT_RELAY_HOST}`
    )
  }
}

export const normalizeStoredRelayConfig = (config: StoredRelayConfig) => ({
  ...config,
  relay_url: normalizeRelayUrl(config.relay_url),
})

export const parseStoredRelayConfigWithMigration = (
  value: string | null
): { config: StoredRelayConfig; migrated: boolean } | null => {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as StoredRelayConfig
    if (
      typeof parsed.relay_url !== 'string' ||
      typeof parsed.room_id !== 'string' ||
      typeof parsed.relay_auth_token !== 'string' ||
      typeof parsed.daemon_public_key !== 'string' ||
      typeof parsed.device_id !== 'string' ||
      typeof parsed.device_keypair?.publicKey !== 'string' ||
      typeof parsed.device_keypair?.secretKey !== 'string' ||
      !Array.isArray(parsed.capabilities)
    ) {
      return null
    }
    const normalized = normalizeStoredRelayConfig(parsed)
    return { config: normalized, migrated: normalized.relay_url !== parsed.relay_url }
  } catch {
    return null
  }
}

// 把扫码 / 手动录入的 relay 入参 + 本机生成的 device keypair 组成可持久化的 StoredRelayConfig。
export const buildStoredRelayConfig = (
  input: RelayPairingInput,
  keypair: RelayDeviceKeypair
): StoredRelayConfig => ({
  capabilities: input.capabilities,
  daemon_public_key: input.daemon_public_key,
  device_id: input.device_id,
  device_keypair: keypair,
  relay_auth_token: input.relay_auth_token,
  relay_url: normalizeRelayUrl(input.relay_url),
  room_id: input.room_id,
})

// 从 SecureStore 读回时严格校验所有必需字段；任一缺失 / 类型不对就当没配（返回 null），
// 避免把半残配置喂给 relay-transport 导致连接时崩。
export const parseStoredRelayConfig = (value: string | null): StoredRelayConfig | null => {
  return parseStoredRelayConfigWithMigration(value)?.config ?? null
}
