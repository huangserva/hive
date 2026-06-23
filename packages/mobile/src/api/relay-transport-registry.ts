import type { StoredRelayConfig } from '../lib/relay-config-store'
import {
  createRelayTransport,
  type RelayTransport,
  type RelayTransportConfig,
} from './relay-transport'

type RelayTransportFactory = (config: RelayTransportConfig) => RelayTransport

const relaySignature = (token: string, relayConfig: StoredRelayConfig | null) => {
  const deviceToken = token.trim()
  if (!deviceToken || !relayConfig) return null
  return JSON.stringify({
    capabilities: relayConfig.capabilities,
    daemon_public_key: relayConfig.daemon_public_key,
    daemon_signing_public_key: relayConfig.daemon_signing_public_key,
    device_id: relayConfig.device_id,
    device_public_key: relayConfig.device_keypair.publicKey,
    relay_auth_token: relayConfig.relay_auth_token,
    relay_protocol_version: relayConfig.relay_protocol_version,
    relay_url: relayConfig.relay_url,
    room_auth_token: relayConfig.room_auth_token,
    room_id: relayConfig.room_id,
    token: deviceToken,
  })
}

export const createRelayTransportRegistry = (
  createTransport: RelayTransportFactory = createRelayTransport
) => {
  let signature: string | null = null
  let transport: RelayTransport | null = null

  const closeCurrent = () => {
    transport?.close()
    transport = null
    signature = null
  }

  return {
    close: closeCurrent,
    get(token: string, relayConfig: StoredRelayConfig | null) {
      const nextSignature = relaySignature(token, relayConfig)
      if (!nextSignature || !relayConfig) {
        closeCurrent()
        return null
      }
      if (transport && signature === nextSignature) return transport
      closeCurrent()
      const deviceToken = token.trim()
      transport = createTransport({ ...relayConfig, device_token: deviceToken })
      signature = nextSignature
      return transport
    },
  }
}
