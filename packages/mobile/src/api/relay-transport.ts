import {
  createHandshakeInitiator,
  decodeBase64,
  decodeJson,
  type EncryptedChannel,
  encodeBase64,
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
  // 换 socket 时等旧 socket 真正 close 的兜底超时：4G 下旧 socket 的 close 帧可能在途，
  // 到点仍没等到 onclose 就放行新连，避免无限期阻塞（代价是换位最多慢 ~0.5s）。
  const CLOSE_GRACE_MS = 500
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
  // in-flight 守卫：connectInternal 入口置 true，到 ready 或任一失败路径清 false。
  // 覆盖 ready→evict→disconnected 之间 connectPromise 已被 finally 清空的窗口，
  // 防止 connect() 因 connectPromise===null 重进 connectInternal 叠开第二条 socket。
  let connecting = false
  let connectPromise: Promise<void> | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
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

  // 换 socket 前先关旧 socket 并等它真正关闭，再开新（消除 relay 槽重叠→evict 1008 churn 的关键）。
  // 挂一个一次性 onclose：只 resolve closedPromise，绝不触发重连 / failConnect；旧 socket 的业务
  // handlers 已 detach。等到 onclose 或 CLOSE_GRACE_MS 超时（取先到者）即放行。
  const closePreviousSocket = (previousSocket: RelayWebSocket): Promise<void> =>
    new Promise<void>((resolveClosed) => {
      let settledClose = false
      let timer: ReturnType<typeof setTimeout> | null = null
      const finish = () => {
        if (settledClose) return
        settledClose = true
        if (timer) clearTimeout(timer)
        resolveClosed()
      }
      detachSocketHandlers(previousSocket)
      previousSocket.onclose = () => finish()
      timer = setTimeout(finish, CLOSE_GRACE_MS)
      try {
        previousSocket.close(1000, 'replaced')
      } catch {
        finish()
      }
    })

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

  const connectInternal = (): Promise<void> => {
    setStatus('connecting')
    connecting = true
    stopHeartbeat()
    channel = null
    return new Promise<void>((resolve, reject) => {
      let settled = false
      let handshake: ReturnType<typeof createHandshakeInitiator> | null = createHandshakeInitiator(
        decodeKeyPair(config.device_keypair)
      )

      const failConnect = (error: Error) => {
        if (settled) return
        settled = true
        connecting = false
        reject(error)
      }

      const openNewSocket = () => {
        const nextSocket = new WebSocketCtor(config.relay_url)
        socket = nextSocket

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
          stopHeartbeat()
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
          // 不在此 scheduleReconnect：transport 是被动连接器，重连由 context 唯一引擎驱动。
          failConnect(new Error('Relay socket closed'))
        }

        nextSocket.onmessage = (event: { data: string }) => {
          try {
            const frame = JSON.parse(String(event.data)) as RelayFrame
            if (frame.type === 'joined') {
              setStatus('handshaking')
              if (!handshake) throw new Error('Relay handshake missing')
              sendFrame({
                // Clear handshake frames go on the wire as base64(JSON) to match
                // the daemon's encodeClearFrame/decodeClearFrame (relay-connector.ts).
                // Plain JSON.stringify here makes the daemon's decodeBase64 throw, so
                // it never recognises the hello as a handshake and replies
                // unknown_session. Field names must also match isHandshakeHello: a
                // nested `handshake` init-message object and a `token`. Both are
                // invisible until a real device handshakes over relay (4G), not LAN.
                payload: encodeBase64(
                  encodeJson({
                    capabilities: config.capabilities,
                    device_id: config.device_id,
                    device_public_key: config.device_keypair.publicKey,
                    handshake: handshake.getInitMessage(),
                    token: config.device_token,
                    type: 'e2ee_hello',
                  })
                ),
                room: config.room_id,
                type: 'data',
              })
              return
            }
            if (frame.type !== 'data' || typeof frame.payload !== 'string') return
            if (!channel) {
              // The daemon's e2ee_ready is base64(JSON) with the response nested
              // under `handshake` (relay-connector.ts encodeClearFrame), not plain
              // JSON flattened at the top level.
              const ready = decodeJson(decodeBase64(frame.payload)) as {
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
              // 注意：不在此清退避。「握手到 ready」会被下一条 socket 秒踢，ready 即清退避会
              // 锁死 1s churn 周期。退避归零交给 context 在拿到真实业务 RPC 成功后做（改7）。
              connecting = false
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
      }

      // 关旧再开新：仅当存在仍 CONNECTING/OPEN 的旧 socket 时才等其关闭（异步路径）；
      // 否则（首连或旧 socket 已关）同步开新，保持原有同步建 socket 语义。
      const previousSocket = socket
      socket = null
      if (previousSocket && (previousSocket.readyState === 0 || previousSocket.readyState === 1)) {
        void closePreviousSocket(previousSocket).then(openNewSocket)
      } else {
        openNewSocket()
      }
    })
  }

  const connect = () => {
    // ready 短路必须校验真实 socket：4G 延迟 close 下 state 可能仍显示 ready 但 socket 已死，
    // 此时不能短路（否则往死 socket 发 RPC），要放行重连。
    if (state === 'ready' && socket && socket.readyState === 1) return Promise.resolve()
    // 非稳定期任何 connect() 复用在途连接，绝不新建第二条。
    if (connectPromise || connecting || state === 'connecting' || state === 'handshaking') {
      return connectPromise ?? Promise.resolve()
    }
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
      stopHeartbeat()
      if (socket) {
        const currentSocket = socket
        detachSocketHandlers(currentSocket)
        currentSocket.close(1000, 'closed')
      }
      socket = null
      channel = null
      connecting = false
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
