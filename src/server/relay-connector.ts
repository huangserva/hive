import WebSocket from 'ws'

import {
  createHandshakeResponder,
  decodeBase64,
  decodeJson,
  type EncryptedChannel,
  encodeBase64,
  encodeJson,
  type HandshakeInitMessage,
  type KeyPair,
} from '../../packages/relay-crypto/src/index.js'

export interface RelayConfig {
  enabled: boolean
  relay_url: string
  relay_auth_token: string
  runtime_id: string
  room_id: string
  daemon_keypair: KeyPair
}

export interface RelayConnectionStatus {
  mode: 'disabled' | 'connecting' | 'connected' | 'backoff' | 'error'
  relay_url: string | null
  room_id: string | null
  connected_at: string | null
  last_heartbeat_at: string | null
  last_error: string | null
}

export interface RelayConnectorHandle {
  status(): RelayConnectionStatus
  close(): void
}

export type RpcHandler = (
  method: string,
  params: unknown,
  deviceId: string,
  capabilities: string[]
) => Promise<unknown>

interface RelayConnectorOptions {
  authenticateDevice?: (token: string) => { capabilities: string[]; id: string }
  heartbeatIntervalMs?: number
  reconnectBaseDelayMs?: number
  reconnectMaxDelayMs?: number
}

type RelayDataFrame = { payload: string; type: 'data' }
type RelayFrame =
  | RelayDataFrame
  | { type: 'heartbeat' }
  | { type: 'heartbeat_ack' }
  | { type: 'joined' }
  | { type: 'error'; code?: string; message?: string }

type RelayHandshakeHello = {
  capabilities?: string[]
  device_id: string
  handshake: HandshakeInitMessage
  token: string
  type: 'e2ee_hello'
}

type ClearHandshakeFrame = RelayHandshakeHello | { type: string }

interface RelayDeviceSession {
  capabilities: string[]
  channel: EncryptedChannel
  deviceId: string
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000
const DEFAULT_RECONNECT_BASE_DELAY_MS = 1_000
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000

const emptyStatus = (config: RelayConfig): RelayConnectionStatus => ({
  connected_at: null,
  last_error: null,
  last_heartbeat_at: null,
  mode: config.enabled ? 'connecting' : 'disabled',
  relay_url: config.enabled ? config.relay_url : null,
  room_id: config.enabled ? config.room_id : null,
})

const decodeClearFrame = (payload: string): ClearHandshakeFrame | null => {
  try {
    return decodeJson(decodeBase64(payload)) as ClearHandshakeFrame
  } catch {
    return null
  }
}

const encodeClearFrame = (frame: unknown) => encodeBase64(encodeJson(frame))

const hasCapabilities = (available: string[], requested: string[]) => {
  const availableSet = new Set(available)
  return requested.every((capability) => availableSet.has(capability))
}

const isHandshakeHello = (frame: ClearHandshakeFrame): frame is RelayHandshakeHello =>
  frame.type === 'e2ee_hello' && 'device_id' in frame && 'handshake' in frame && 'token' in frame

const parseRelayFrame = (data: WebSocket.RawData): RelayFrame | null => {
  try {
    const parsed = JSON.parse(data.toString()) as unknown
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) return null
    return parsed as RelayFrame
  } catch {
    return null
  }
}

const normalizeRpcError = (error: unknown) => ({
  code: -32000,
  message: error instanceof Error ? error.message : String(error),
})

export const createRelayConnector = (
  config: RelayConfig,
  rpcHandler: RpcHandler,
  options: RelayConnectorOptions = {}
): RelayConnectorHandle => {
  let status = emptyStatus(config)
  let socket: WebSocket | null = null
  let heartbeatTimer: NodeJS.Timeout | null = null
  let reconnectTimer: NodeJS.Timeout | null = null
  let reconnectDelayMs = options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS
  let closed = false
  const sessions = new Map<string, RelayDeviceSession>()

  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
  const reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS
  const reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS

  const sendRelayFrame = (frame: unknown) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(frame))
    }
  }

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  const startHeartbeat = () => {
    stopHeartbeat()
    heartbeatTimer = setInterval(() => {
      sendRelayFrame({ type: 'heartbeat' })
    }, heartbeatIntervalMs)
    heartbeatTimer.unref()
  }

  const scheduleReconnect = (error: unknown) => {
    if (closed || !config.enabled) return
    stopHeartbeat()
    status = {
      ...status,
      connected_at: null,
      last_error: error instanceof Error ? error.message : String(error),
      mode: 'backoff',
    }
    const delay = reconnectDelayMs
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, reconnectMaxDelayMs)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
    reconnectTimer.unref()
  }

  const handleHandshake = (frame: ClearHandshakeFrame) => {
    if (!isHandshakeHello(frame)) return false
    try {
      const authenticated = options.authenticateDevice?.(frame.token) ?? {
        capabilities: frame.capabilities ?? [],
        id: frame.device_id,
      }
      if (authenticated.id !== frame.device_id) {
        sendRelayFrame({
          payload: encodeClearFrame({ code: 'device_mismatch', type: 'e2ee_error' }),
          type: 'data',
        })
        return true
      }

      const requestedCapabilities = frame.capabilities ?? authenticated.capabilities
      if (!hasCapabilities(authenticated.capabilities, requestedCapabilities)) {
        sendRelayFrame({
          payload: encodeClearFrame({ code: 'capability_denied', type: 'e2ee_error' }),
          type: 'data',
        })
        return true
      }

      const responder = createHandshakeResponder(config.daemon_keypair)
      responder.processInit(frame.handshake)
      const response = responder.getResponse()
      sessions.set(frame.device_id, {
        capabilities: requestedCapabilities,
        channel: responder.getChannel(),
        deviceId: frame.device_id,
      })
      sendRelayFrame({
        payload: encodeClearFrame({
          device_id: frame.device_id,
          handshake: response,
          runtime_id: config.runtime_id,
          type: 'e2ee_ready',
        }),
        type: 'data',
      })
    } catch (error) {
      sendRelayFrame({
        payload: encodeClearFrame({
          code: 'handshake_failed',
          message: error instanceof Error ? error.message : String(error),
          type: 'e2ee_error',
        }),
        type: 'data',
      })
    }
    return true
  }

  const handleEncryptedRpc = async (payload: string) => {
    for (const session of sessions.values()) {
      const plaintext = session.channel.decrypt(payload)
      if (!plaintext) continue
      const request = decodeJson(plaintext) as {
        id?: string
        method?: string
        params?: unknown
      }
      if (typeof request.method !== 'string') {
        throw new Error('Invalid JSON-RPC method')
      }
      const id = request.id ?? null
      try {
        const result = await rpcHandler(
          request.method,
          request.params ?? {},
          session.deviceId,
          session.capabilities
        )
        sendRelayFrame({
          payload: session.channel.encrypt(encodeJson({ id, jsonrpc: '2.0', result })),
          type: 'data',
        })
      } catch (error) {
        sendRelayFrame({
          payload: session.channel.encrypt(
            encodeJson({ error: normalizeRpcError(error), id, jsonrpc: '2.0' })
          ),
          type: 'data',
        })
      }
      return
    }
    sendRelayFrame({
      payload: encodeClearFrame({ code: 'unknown_session', type: 'e2ee_error' }),
      type: 'data',
    })
  }

  const handleDataFrame = (frame: RelayDataFrame) => {
    const clearFrame = decodeClearFrame(frame.payload)
    if (clearFrame && handleHandshake(clearFrame)) return
    void handleEncryptedRpc(frame.payload)
  }

  function connect() {
    if (closed || !config.enabled) return
    status = {
      ...status,
      last_error: null,
      mode: 'connecting',
    }
    socket = new WebSocket(config.relay_url)
    socket.on('open', () => {
      sendRelayFrame({
        auth_token: config.relay_auth_token,
        role: 'daemon',
        room: config.room_id,
        type: 'join',
      })
    })
    socket.on('message', (data) => {
      const frame = parseRelayFrame(data)
      if (!frame) return
      if (frame.type === 'joined') {
        reconnectDelayMs = reconnectBaseDelayMs
        status = {
          ...status,
          connected_at: new Date().toISOString(),
          last_error: null,
          mode: 'connected',
        }
        startHeartbeat()
        return
      }
      if (frame.type === 'heartbeat' || frame.type === 'heartbeat_ack') {
        status = {
          ...status,
          last_heartbeat_at: new Date().toISOString(),
        }
        if (frame.type === 'heartbeat') sendRelayFrame({ type: 'heartbeat' })
        return
      }
      if (frame.type === 'data') {
        handleDataFrame(frame)
        return
      }
      if (frame.type === 'error') {
        status = {
          ...status,
          last_error: frame.message ?? frame.code ?? 'Relay error',
          mode: 'error',
        }
      }
    })
    socket.on('error', (error) => {
      status = {
        ...status,
        last_error: error.message,
        mode: 'error',
      }
    })
    socket.on('close', () => {
      socket = null
      sessions.clear()
      scheduleReconnect(status.last_error ?? 'Relay connection closed')
    })
  }

  if (config.enabled) {
    connect()
  }

  return {
    close() {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      stopHeartbeat()
      socket?.close()
      socket = null
      sessions.clear()
    },
    status() {
      return { ...status }
    },
  }
}
