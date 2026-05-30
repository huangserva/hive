import {
  createHandshakeInitiator,
  decodeBase64,
  decodeJson,
  type EncryptedChannel,
  encodeJson,
  type KeyPair,
} from '@huangserva/hippoteam-relay-crypto'

export interface RelayTransportConfig {
  capabilities: string[]
  daemon_public_key: string
  device_id: string
  device_keypair: { publicKey: string; secretKey: string }
  device_token: string
  // 进 relay room 的门禁 token，必须与 relay server 的 RELAY_AUTH_TOKEN 一致；
  // 随 join 帧上送，否则 relay server 直接以 unauthorized 拒绝。
  relay_auth_token: string
  relay_url: string
  room_id: string
}

export type RelayTransportStatus = 'disconnected' | 'connecting' | 'handshaking' | 'ready' | 'error'

export interface RelayTransportDiagnosticEvent {
  code?: number
  error?: string
  reason?: string
  status?: RelayTransportStatus
  ts: number
  type: 'socket_close' | 'socket_error' | 'status'
}

export interface RelayTransport {
  call<T>(method: string, params?: unknown): Promise<T>
  close(): void
  connect(): Promise<void>
  onDiagnosticsEvent?: (cb: (event: RelayTransportDiagnosticEvent) => void) => () => void
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
  const diagnosticsListeners = new Set<(event: RelayTransportDiagnosticEvent) => void>()
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
  let connectPromise: Promise<void> | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let reconnectAttempts = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let rpcCounter = 0
  let socket: RelayWebSocket | null = null
  let state: RelayTransportStatus = 'disconnected'

  const setStatus = (next: RelayTransportStatus) => {
    if (state === next) return
    state = next
    for (const listener of listeners) listener(next)
    for (const listener of diagnosticsListeners) {
      listener({ status: next, ts: Date.now(), type: 'status' })
    }
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

  const detachSocketHandlers = (target: RelayWebSocket) => {
    target.onclose = null
    target.onerror = null
    target.onmessage = null
    target.onopen = null
  }

  const clearReconnectTimer = () => {
    if (!reconnectTimer) return
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  const scheduleReconnect = () => {
    if (closedByUser) return
    if (reconnectTimer) return
    stopHeartbeat()
    channel = null
    const delay = Math.min(reconnectBaseMs * 2 ** reconnectAttempts, reconnectMaxMs)
    reconnectAttempts += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (closedByUser) return
      void connect().catch(() => {
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
      stopHeartbeat()
      channel = null
      if (socket) {
        const previousSocket = socket
        detachSocketHandlers(previousSocket)
        previousSocket.close(1000, 'replaced')
        socket = null
      }
      const nextSocket = new WebSocketCtor(config.relay_url)
      socket = nextSocket
      let settled = false
      let handshake: ReturnType<typeof createHandshakeInitiator> | null = createHandshakeInitiator(
        decodeKeyPair(config.device_keypair)
      )

      const failConnect = (error: Error) => {
        if (settled) return
        settled = true
        reject(error)
      }

      nextSocket.onopen = () => {
        try {
          sendFrame({
            auth_token: config.relay_auth_token,
            connection_id: config.device_id,
            role: 'device',
            room: config.room_id,
            type: 'join',
            version: 1,
          })
        } catch (error) {
          failConnect(error instanceof Error ? error : new Error(String(error)))
        }
      }

      nextSocket.onerror = (event: unknown) => {
        setStatus('error')
        const error = event instanceof Error ? event.message : 'Relay socket error'
        for (const listener of diagnosticsListeners) {
          listener({ error, ts: Date.now(), type: 'socket_error' })
        }
        failConnect(event instanceof Error ? event : new Error(error))
      }

      nextSocket.onclose = (event: unknown) => {
        for (const request of pending.values()) request.reject(new Error('Relay socket closed'))
        pending.clear()
        if (socket === nextSocket) socket = null
        setStatus('disconnected')
        const closeEvent = event as { code?: unknown; reason?: unknown }
        for (const listener of diagnosticsListeners) {
          listener({
            code: typeof closeEvent?.code === 'number' ? closeEvent.code : undefined,
            reason: typeof closeEvent?.reason === 'string' ? closeEvent.reason : undefined,
            ts: Date.now(),
            type: 'socket_close',
          })
        }
        failConnect(new Error('Relay socket closed'))
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
                // Field names must match the daemon's handshake contract
                // (relay-connector.ts isHandshakeHello): a nested `handshake`
                // init-message object and a `token` field. The relay only
                // forwards opaque payloads, so a mismatch here is invisible
                // until a real device handshakes over relay (4G), not LAN.
                handshake: handshake.getInitMessage(),
                token: config.device_token,
                type: 'e2ee_hello',
              }),
              room: config.room_id,
              type: 'data',
            })
            return
          }
          if (frame.type !== 'data' || typeof frame.payload !== 'string') return
          if (!channel) {
            // The daemon replies with the response nested under `handshake`
            // (relay-connector.ts e2ee_ready), not flattened at the top level.
            const ready = JSON.parse(frame.payload) as {
              handshake?: { ephemeral_public_key?: string }
              type?: string
            }
            if (
              ready.type !== 'e2ee_ready' ||
              !ready.handshake?.ephemeral_public_key ||
              !handshake
            ) {
              throw new Error('Invalid relay handshake response')
            }
            channel = handshake.processResponse({
              ephemeral_public_key: ready.handshake.ephemeral_public_key,
            })
            handshake = null
            reconnectAttempts = 0
            setStatus('ready')
            startHeartbeat()
            settled = true
            resolve()
            return
          }
          handleEncryptedPayload(frame.payload)
        } catch (error) {
          setStatus('error')
          failConnect(error instanceof Error ? error : new Error(String(error)))
        }
      }
    })

  const connect = () => {
    closedByUser = false
    if (state === 'ready') return Promise.resolve()
    if (connectPromise) return connectPromise
    connectPromise = connectInternal().finally(() => {
      connectPromise = null
    })
    return connectPromise
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
      clearReconnectTimer()
      stopHeartbeat()
      if (socket) {
        const currentSocket = socket
        detachSocketHandlers(currentSocket)
        currentSocket.close(1000, 'closed')
      }
      socket = null
      channel = null
      setStatus('disconnected')
    },
    connect,
    onDiagnosticsEvent(cb) {
      diagnosticsListeners.add(cb)
      return () => diagnosticsListeners.delete(cb)
    },
    onStatusChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    status() {
      return state
    },
  }
}
