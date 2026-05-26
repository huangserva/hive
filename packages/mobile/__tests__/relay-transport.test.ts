import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  createHandshakeResponder,
  decodeJson,
  encodeJson,
  generateKeyPair,
} from '../../relay-crypto/src/index.js'
import { createRuntimeClient } from '../src/api/client.js'
import { createRelayTransport, type RelayTransportConfig } from '../src/api/relay-transport.js'

class FakeRelaySocket {
  static instances: FakeRelaySocket[] = []

  onclose: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  readyState = 0
  sent: unknown[] = []

  constructor(readonly url: string) {
    FakeRelaySocket.instances.push(this)
    setTimeout(() => {
      this.readyState = 1
      this.onopen?.()
    }, 0)
  }

  send(data: string) {
    this.sent.push(JSON.parse(data) as unknown)
  }

  close(code = 1000, reason = 'closed') {
    this.readyState = 3
    this.onclose?.({ code, reason })
  }

  receive(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) })
  }
}

const toBase64 = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const buildConfig = (): RelayTransportConfig => {
  const daemon = generateKeyPair()
  const device = generateKeyPair()
  return {
    capabilities: ['read_dashboard', 'send_prompt', 'admin_runtime'],
    daemon_public_key: toBase64(daemon.publicKey),
    device_id: 'device-1',
    device_keypair: {
      publicKey: toBase64(device.publicKey),
      secretKey: toBase64(device.secretKey),
    },
    device_token: 'mobile-token',
    relay_url: 'wss://relay.example.test/v1',
    room_id: 'room-1',
  }
}

const latestSocket = () => {
  const socket = FakeRelaySocket.instances.at(-1)
  if (!socket) throw new Error('No fake socket')
  return socket
}

const setupReadyRelay = async () => {
  const config = buildConfig()
  const transport = createRelayTransport(config, {
    WebSocketCtor: FakeRelaySocket,
    reconnectBaseMs: 10,
  })
  const connectPromise = transport.connect()
  await vi.advanceTimersByTimeAsync(0)
  const socket = latestSocket()
  expect(socket.sent[0]).toMatchObject({ role: 'device', room: 'room-1', type: 'join' })
  socket.receive({ type: 'joined' })
  const helloFrame = socket.sent.at(-1) as { payload: string; type: string }
  expect(helloFrame.type).toBe('data')
  const hello = JSON.parse(helloFrame.payload) as {
    device_id: string
    ephemeral_public_key: string
    token_proof: string
    type: string
  }
  expect(hello).toMatchObject({
    device_id: 'device-1',
    token_proof: 'mobile-token',
    type: 'e2ee_hello',
  })
  const responder = createHandshakeResponder(generateKeyPair())
  responder.processInit({ ephemeral_public_key: hello.ephemeral_public_key })
  socket.receive({
    payload: JSON.stringify({ type: 'e2ee_ready', ...responder.getResponse() }),
    type: 'data',
  })
  await connectPromise
  return { channel: responder.getChannel(), socket, transport }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeRelaySocket.instances = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('relay transport', () => {
  test('connects, joins the relay room, and completes the E2E handshake', async () => {
    const { transport } = await setupReadyRelay()

    expect(transport.status()).toBe('ready')
  })

  test('encrypts JSON-RPC calls and resolves matching encrypted responses', async () => {
    const { channel, socket, transport } = await setupReadyRelay()

    const callPromise = transport.call<{ version: string }>('runtime.status')
    const encryptedRequest = socket.sent.at(-1) as { payload: string; type: string }
    expect(encryptedRequest.type).toBe('data')
    const request = decodeJson(channel.decrypt(encryptedRequest.payload) ?? new Uint8Array()) as {
      id: string
      method: string
    }
    expect(request.method).toBe('runtime.status')

    socket.receive({
      payload: channel.encrypt(encodeJson({ id: request.id, result: { version: '2.0.0' } })),
      type: 'data',
    })

    await expect(callPromise).resolves.toEqual({ version: '2.0.0' })
  })

  test('rejects JSON-RPC calls when encrypted response carries an error', async () => {
    const { channel, socket, transport } = await setupReadyRelay()

    const callPromise = transport.call('worker.stop', { worker_id: 'w1' })
    const encryptedRequest = socket.sent.at(-1) as { payload: string }
    const request = decodeJson(channel.decrypt(encryptedRequest.payload) ?? new Uint8Array()) as {
      id: string
    }
    socket.receive({
      payload: channel.encrypt(
        encodeJson({
          error: { code: 'missing_mobile_capability', message: 'denied' },
          id: request.id,
        })
      ),
      type: 'data',
    })

    await expect(callPromise).rejects.toThrow('denied')
  })

  test('sends heartbeat frames every 20 seconds while ready', async () => {
    const { socket } = await setupReadyRelay()

    await vi.advanceTimersByTimeAsync(20_000)

    expect(socket.sent.at(-1)).toMatchObject({ room: 'room-1', type: 'heartbeat' })
  })

  test('notifies status changes during connect and handshake', async () => {
    const config = buildConfig()
    const transport = createRelayTransport(config, { WebSocketCtor: FakeRelaySocket })
    const statuses: string[] = []
    transport.onStatusChange((status) => statuses.push(status))

    const connectPromise = transport.connect()
    await vi.advanceTimersByTimeAsync(0)
    latestSocket().receive({ type: 'joined' })

    expect(statuses).toContain('connecting')
    expect(statuses).toContain('handshaking')
    connectPromise.catch(() => {})
  })

  test('reconnects with backoff after an established socket closes', async () => {
    const { socket, transport } = await setupReadyRelay()
    expect(FakeRelaySocket.instances).toHaveLength(1)

    socket.close(1006, 'network')
    await vi.advanceTimersByTimeAsync(10)

    expect(transport.status()).toBe('connecting')
    expect(FakeRelaySocket.instances).toHaveLength(2)
  })
})

describe('runtime client relay fallback', () => {
  test('uses LAN first and falls back to relay JSON-RPC after LAN timeout/failure', async () => {
    const relay = {
      call: vi.fn().mockResolvedValue({ version: 'relay-version' }),
      close: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      onStatusChange: vi.fn(() => () => {}),
      status: vi.fn(() => 'ready' as const),
    }
    const client = createRuntimeClient({
      fetchImpl: vi.fn().mockRejectedValue(new Error('network down')),
      host: '10.0.0.2:4010',
      relayTransport: relay,
      token: 'mobile-token',
    })

    await expect(client.getMobileRuntimeStatus()).resolves.toEqual({ version: 'relay-version' })
    expect(client.connectionMode()).toBe('relay')
    expect(relay.call).toHaveBeenCalledWith('runtime.status')
  })
})
