import {
  createHandshakeInitiator,
  decodeBase64,
  decodeJson,
  type EncryptedChannel,
  encodeJson,
  type KeyPair,
} from '../../../relay-crypto/src/index.js'

export interface RelayTransportConfig {
  capabilities: string[]
  daemon_public_key: string
  device_id: string
  device_keypair: { publicKey: string; secretKey: string }
  device_token: string
  relay_url: string
  room_id: string
}

export type RelayTransportStatus = 'disconnected' | 'connecting' | 'handshaking' | 'ready' | 'error'

export interface RelayTransport {
  call<T>(method: string, params?: unknown): Promise<T>
  close(): void
  connect(): Promise<void>
  onStatusChange(cb: (status: string) => void): () => void
  status(): RelayTransportStatus
}

interface RelayTransportDeps {
  WebSocketCtor?: new (url: string) => RelayWebSocket
  reconnectBaseMs?: number
  reconnectMaxMs?: number
}

interface RelayWebSocket {
  close(code?: number, reason?: string): void
  onclose: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
  onmessage: ((event: { data: string }) => void) | null
  onopen: (() => void) | null
  readyState: number
  send(data: string): void
}

interface RelayFrame {
  payload?: string
  room?: string
  type?: string
}

interface JsonRpcResponse {
  error?: { code?: string; message?: string }
  id?: string
  result?: unknown
}

const decodeKeyPair = (keypair: RelayTransportConfig['device_keypair']): KeyPair => ({
  publicKey: decodeBase64(keypair.publicKey),
  secretKey: decodeBase64(keypair.secretKey),
})

export const createRelayTransport = (
  config: RelayTransportConfig,
  deps: RelayTransportDeps = {}
): RelayTransport => {
  const WebSocketCtor =
    deps.WebSocketCtor ?? (WebSocket as unknown as new (url: string) => RelayWebSocket)
  const reconnectBaseMs = deps.reconnectBaseMs ?? 1000
  const reconnectMaxMs = deps.reconnectMaxMs ?? 30_000
  const listeners = new Set<(status: string) => void>()
  const pending = new Map<
    string,
    {
      reject: (error: Error) => void
      resolve: (value: unknown) => void
    }
  >()
  let channel: EncryptedChannel | null = null
  let closedByUser = false
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let reconnectAttempts = 0
  let rpcCounter = 0
  let socket: RelayWebSocket | null = null
  let state: RelayTransportStatus = 'disconnected'

  const setStatus = (next: RelayTransportStatus) => {
    if (state === next) return
    state = next
    for (const listener of listeners) listener(next)
  }

  const sendFrame = (frame: unknown) => {
    if (!socket || socket.readyState !== 1) throw new Error('Relay socket is not open')
    socket.send(JSON.stringify(frame))
  }

  const stopHeartbeat = () => {
    if (!heartbeat) return
    clearInterval(heartbeat)
    heartbeat = null
  }

  const startHeartbeat = () => {
    stopHeartbeat()
    heartbeat = setInterval(() => {
      try {
        sendFrame({
          connection_id: config.device_id,
          room: config.room_id,
          ts: Date.now(),
          type: 'heartbeat',
        })
      } catch {
        // The close/error path will move the transport into reconnect.
      }
    }, 20_000)
  }

  const scheduleReconnect = () => {
    if (closedByUser) return
    stopHeartbeat()
    channel = null
    const delay = Math.min(reconnectBaseMs * 2 ** reconnectAttempts, reconnectMaxMs)
    reconnectAttempts += 1
    setTimeout(() => {
      if (closedByUser) return
      void connectInternal().catch(() => {
        setStatus('error')
        scheduleReconnect()
      })
    }, delay)
  }

  const handleEncryptedPayload = (payload: string) => {
    if (!channel) return
    const decrypted = channel.decrypt(payload)
    if (!decrypted) return
    const message = decodeJson(decrypted) as JsonRpcResponse
    if (!message.id) return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) {
      request.reject(new Error(message.error.message ?? message.error.code ?? 'Relay RPC failed'))
      return
    }
    request.resolve(message.result)
  }

  const connectInternal = () =>
    new Promise<void>((resolve, reject) => {
      setStatus('connecting')
      const nextSocket = new WebSocketCtor(config.relay_url)
      socket = nextSocket
      let handshake: ReturnType<typeof createHandshakeInitiator> | null = createHandshakeInitiator(
        decodeKeyPair(config.device_keypair)
      )

      nextSocket.onopen = () => {
        try {
          sendFrame({
            connection_id: config.device_id,
            role: 'device',
            room: config.room_id,
            type: 'join',
            version: 1,
          })
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      }

      nextSocket.onerror = (event: unknown) => {
        setStatus('error')
        reject(event instanceof Error ? event : new Error('Relay socket error'))
      }

      nextSocket.onclose = () => {
        for (const request of pending.values()) request.reject(new Error('Relay socket closed'))
        pending.clear()
        if (!closedByUser) scheduleReconnect()
      }

      nextSocket.onmessage = (event: { data: string }) => {
        try {
          const frame = JSON.parse(String(event.data)) as RelayFrame
          if (frame.type === 'joined') {
            setStatus('handshaking')
            if (!handshake) throw new Error('Relay handshake missing')
            sendFrame({
              payload: JSON.stringify({
                capabilities: config.capabilities,
                device_id: config.device_id,
                device_public_key: config.device_keypair.publicKey,
                ephemeral_public_key: handshake.getInitMessage().ephemeral_public_key,
                token_proof: config.device_token,
                type: 'e2ee_hello',
              }),
              room: config.room_id,
              type: 'data',
            })
            return
          }
          if (frame.type !== 'data' || typeof frame.payload !== 'string') return
          if (!channel) {
            const ready = JSON.parse(frame.payload) as {
              ephemeral_public_key?: string
              type?: string
            }
            if (ready.type !== 'e2ee_ready' || !ready.ephemeral_public_key || !handshake) {
              throw new Error('Invalid relay handshake response')
            }
            channel = handshake.processResponse({
              ephemeral_public_key: ready.ephemeral_public_key,
            })
            handshake = null
            reconnectAttempts = 0
            setStatus('ready')
            startHeartbeat()
            resolve()
            return
          }
          handleEncryptedPayload(frame.payload)
        } catch (error) {
          setStatus('error')
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      }
    })

  const connect = () => {
    closedByUser = false
    if (state === 'ready') return Promise.resolve()
    return connectInternal()
  }

  return {
    call<T>(method: string, params?: unknown) {
      if (!channel || state !== 'ready')
        return Promise.reject(new Error('Relay transport not ready'))
      const id = `rpc-${Date.now()}-${rpcCounter++}`
      const payload = channel.encrypt(encodeJson({ id, jsonrpc: '2.0', method, params }))
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { reject, resolve: (value) => resolve(value as T) })
        try {
          sendFrame({ payload, room: config.room_id, type: 'data' })
        } catch (error) {
          pending.delete(id)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    },
    close() {
      closedByUser = true
      stopHeartbeat()
      socket?.close(1000, 'closed')
      socket = null
      channel = null
      setStatus('disconnected')
    },
    connect,
    onStatusChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    status() {
      return state
    },
  }
}
