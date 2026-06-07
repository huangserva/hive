import { describe, expect, test, vi } from 'vitest'
import type { RelayTransport, RelayTransportStatus } from '../src/api/relay-transport.js'
import { createRelayTransportRegistry } from '../src/api/relay-transport-registry.js'
import type { StoredRelayConfig } from '../src/lib/relay-config-store.js'

const buildRelayConfig = (overrides: Partial<StoredRelayConfig> = {}): StoredRelayConfig => ({
  capabilities: ['read_dashboard', 'send_prompt'],
  daemon_public_key: 'daemon-public',
  device_id: 'device-1',
  device_keypair: {
    publicKey: 'device-public',
    secretKey: 'device-secret',
  },
  relay_auth_token: 'relay-auth',
  relay_url: 'wss://relay.example.test',
  room_id: 'room-1',
  ...overrides,
})

const createFakeTransport = () => {
  const transport: RelayTransport = {
    call: vi.fn(),
    close: vi.fn(),
    connect: vi.fn(),
    measureVoiceStreamLatency: vi.fn(),
    onEvent: vi.fn(() => () => {}),
    onStatusChange: vi.fn(() => () => {}),
    onVoiceDownlinkSegmentFrame: vi.fn(() => () => {}),
    onWebRtcSignalFrame: vi.fn(() => () => {}),
    onVoiceStreamFrame: vi.fn(() => () => {}),
    requestVoiceStreamSynthesis: vi.fn(),
    sendWebRtcSignalFrame: vi.fn(),
    sendVoiceStreamFrame: vi.fn(),
    status: vi.fn((): RelayTransportStatus => 'disconnected'),
  }
  return transport
}

describe('relay transport registry', () => {
  test('reuses the same relay transport while signature is unchanged', () => {
    const transports: RelayTransport[] = []
    const createTransport = vi.fn(() => {
      const transport = createFakeTransport()
      transports.push(transport)
      return transport
    })
    const registry = createRelayTransportRegistry(createTransport)
    const relayConfig = buildRelayConfig()

    const first = registry.get(' mobile-token ', relayConfig)
    const second = registry.get('mobile-token', relayConfig)
    const sameRelayDifferentHost = registry.get('mobile-token', relayConfig)

    expect(first).toBe(second)
    expect(second).toBe(sameRelayDifferentHost)
    expect(createTransport).toHaveBeenCalledTimes(1)
    expect(createTransport).toHaveBeenCalledWith({ ...relayConfig, device_token: 'mobile-token' })
    expect(transports[0]?.close).not.toHaveBeenCalled()
  })

  test('creates a new transport and closes the old one when signature changes', () => {
    const transports: RelayTransport[] = []
    const createTransport = vi.fn(() => {
      const transport = createFakeTransport()
      transports.push(transport)
      return transport
    })
    const registry = createRelayTransportRegistry(createTransport)
    const relayConfig = buildRelayConfig()

    const first = registry.get('token-a', relayConfig)
    const second = registry.get('token-b', relayConfig)
    const third = registry.get('token-b', buildRelayConfig({ room_id: 'room-2' }))

    expect(second).not.toBe(first)
    expect(third).not.toBe(second)
    expect(createTransport).toHaveBeenCalledTimes(3)
    expect(transports[0]?.close).toHaveBeenCalledTimes(1)
    expect(transports[1]?.close).toHaveBeenCalledTimes(1)
    expect(transports[2]?.close).not.toHaveBeenCalled()
  })

  test('closes cached transport when relay config becomes unavailable', () => {
    const transport = createFakeTransport()
    const registry = createRelayTransportRegistry(vi.fn(() => transport))

    expect(registry.get('mobile-token', buildRelayConfig())).toBe(transport)
    expect(registry.get('mobile-token', null)).toBeNull()

    expect(transport.close).toHaveBeenCalledTimes(1)
  })
})
