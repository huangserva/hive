// 配对二维码解析 —— 抽到 lib 便于不依赖 RN 原生模块地单测。
// 纯 LAN 二维码只含 { host, token }；relay.json 配好的 runtime 会额外塞 relay 段。

export interface RelayPairingInput {
  capabilities: string[]
  daemon_public_key: string
  device_id: string
  relay_auth_token: string
  relay_url: string
  room_id: string
}

export interface ParsedConnectionQr {
  host: string
  relay?: RelayPairingInput
  token: string
}

export const ALL_MOBILE_CAPABILITIES = [
  'read_dashboard',
  'read_terminal',
  'send_prompt',
  'approve_risk',
  'admin_runtime',
]

// relay 段需要 relay_url/room_id/relay_auth_token/daemon 公钥/device_id 全齐才成立；
// 缺任意一项就退回纯 LAN（不破坏旧 host/token 二维码）。capabilities 缺省给全集。
export const extractRelay = (value: Record<string, unknown>): RelayPairingInput | undefined => {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const relayUrl = str(value.relay_url)
  const roomId = str(value.room_id)
  const authToken = str(value.relay_auth_token)
  const daemonPublicKey = str(value.daemon_public_key)
  const deviceId = str(value.device_id)
  if (!relayUrl || !roomId || !authToken || !daemonPublicKey || !deviceId) return undefined
  const capabilities =
    Array.isArray(value.capabilities) && value.capabilities.every((c) => typeof c === 'string')
      ? (value.capabilities as string[])
      : ALL_MOBILE_CAPABILITIES
  return {
    capabilities,
    daemon_public_key: daemonPublicKey,
    device_id: deviceId,
    relay_auth_token: authToken,
    relay_url: relayUrl,
    room_id: roomId,
  }
}

export const parseConnectionQr = (raw: string): ParsedConnectionQr | null => {
  const fromObject = (value: unknown): ParsedConnectionQr | null => {
    if (!value || typeof value !== 'object') return null
    const candidate = value as { host?: unknown; token?: unknown }
    if (typeof candidate.host !== 'string' || typeof candidate.token !== 'string') return null
    const host = candidate.host.trim()
    const token = candidate.token.trim()
    if (!host || !token) return null
    const relay = extractRelay(value as Record<string, unknown>)
    return relay ? { host, relay, token } : { host, token }
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    const payload = fromObject(parsed)
    if (payload) return payload
  } catch {}

  try {
    const url = new URL(raw)
    const host = url.searchParams.get('host')?.trim()
    const token = url.searchParams.get('token')?.trim()
    return host && token ? { host, token } : null
  } catch {
    return null
  }
}
