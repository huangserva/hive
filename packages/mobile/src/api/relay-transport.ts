import {
  createHandshakeInitiator,
  decodeBase64,
  decodeJson,
  type EncryptedChannel,
  encodeBase64,
  encodeJson,
  type KeyPair,
} from '@huangserva/hippoteam-relay-crypto'
import {
  calculateVoiceStreamLatency,
  createVoiceStreamFrame,
  createVoiceStreamReassembler,
  isVoiceStreamFrame,
  nextVoiceStreamId,
  type VoiceStreamAudioResult,
  type VoiceStreamFrame,
  type VoiceStreamLatencyOptions,
  type VoiceStreamLatencyResult,
} from './voice-stream-protocol'

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

// 服务器主动推送的事件帧（M27 Part B），无 RPC id，type:'event'。
export interface RelayTransportEvent {
  kind: string
  payload?: unknown
}

export interface RelayTransport {
  call<T>(method: string, params?: unknown): Promise<T>
  close(): void
  connect(): Promise<void>
  measureVoiceStreamLatency(options?: VoiceStreamLatencyOptions): Promise<VoiceStreamLatencyResult>
  onDiagnosticsEvent?: (cb: (event: RelayTransportDiagnosticEvent) => void) => () => void
  onEvent(cb: (event: RelayTransportEvent) => void): () => void
  onStatusChange(cb: (status: string) => void): () => void
  onVoiceStreamFrame(cb: (frame: VoiceStreamFrame) => void): () => void
  requestVoiceStreamSynthesis(text: string): Promise<VoiceStreamAudioResult>
  sendVoiceStreamFrame(frame: VoiceStreamFrame): void
  status(): RelayTransportStatus
}

interface RelayTransportDeps {
  WebSocketCtor?: new (url: string) => RelayWebSocket
  reconnectBaseMs?: number
  reconnectMaxMs?: number
  // 注入点（仅测试用，生产走默认）：心跳间隔 / 探活判死阈值 / 单条 RPC 超时。
  heartbeatIntervalMs?: number
  livenessTimeoutMs?: number
  rpcTimeoutMs?: number
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
  // 心跳间隔。device 每 HEARTBEAT_INTERVAL_MS 发一帧 heartbeat，relay 回 heartbeat_ack（入站帧）。
  const HEARTBEAT_INTERVAL_MS = deps.heartbeatIntervalMs ?? 20_000
  // device 端 socket 探活判死阈值（dispatch 8855a45c 修复2a，对称 daemon ① 的 lastInboundAt 探活）：
  // 心跳 tick 时若「自上次收到任何入站帧」超过此阈值，判 socket 半死并主动关闭 → 上层重连自愈。
  // 默认 = 心跳间隔×2 + 5s（≈45s），容忍单次 ack 丢失，避免误杀慢但活的 4G 连接。
  const LIVENESS_TIMEOUT_MS = deps.livenessTimeoutMs ?? HEARTBEAT_INTERVAL_MS * 2 + 5_000
  // 每条 RPC 的超时（P0 修复）：4G/后台切换后 relay socket 常半死（readyState 仍=1 但对端已没了），
  // 没有此超时则 call() 的 promise 永远 pending → sendPromptToOrchestrator 永久挂起（消息发不出去、
  // 不进 server）、foreground 探针的 getMobileRuntimeStatus 永久挂起（reconnecting 卡死 true → 所有
  // 发送被 queue、outbox flush/轮询全停）。超时后 **只 reject 不关 socket**（dispatch 8855a45c 修复2a：
  // 关 socket 会在 4G 上引发 churn 环——见 connectInternal 注释）；socket 真死交给上面的探活判定。
  // 阈值取 22s：relay 走 device→relay→daemon 往返，4G RTT 远高于 LAN，15s 偏紧会误超时。
  const RPC_TIMEOUT_MS = deps.rpcTimeoutMs ?? 22_000
  const diagnosticsListeners = new Set<(event: RelayTransportDiagnosticEvent) => void>()
  const eventListeners = new Set<(event: RelayTransportEvent) => void>()
  const listeners = new Set<(status: string) => void>()
  const voiceStreamListeners = new Set<(frame: VoiceStreamFrame) => void>()
  const pending = new Map<
    string,
    {
      reject: (error: Error) => void
      resolve: (value: unknown) => void
      timer: ReturnType<typeof setTimeout> | null
    }
  >()
  const settlePending = (id: string) => {
    const request = pending.get(id)
    if (!request) return null
    if (request.timer) clearTimeout(request.timer)
    pending.delete(id)
    return request
  }
  // 清空并 reject 所有未结算 RPC（HIGH 修复）：onclose / onerror 都必须调它——某些 RN/Hermes 下
  // onerror 可能不再跟 onclose，若只在 onclose 清 pending，那些在途 RPC 会泄漏到各自 22s 超时才 reject。
  const rejectAllPending = (reason: string) => {
    for (const request of pending.values()) {
      if (request.timer) clearTimeout(request.timer)
      request.reject(new Error(reason))
    }
    pending.clear()
  }
  let channel: EncryptedChannel | null = null
  // in-flight 守卫：connectInternal 入口置 true，到 ready 或任一失败路径清 false。
  // 覆盖 ready→evict→disconnected 之间 connectPromise 已被 finally 清空的窗口，
  // 防止 connect() 因 connectPromise===null 重进 connectInternal 叠开第二条 socket。
  let connecting = false
  let connectPromise: Promise<void> | null = null
  // 取消在途 connectInternal 的句柄（HIGH ghost-socket 修复）：close() 调它，让换 socket 的
  // closePreviousSocket().then(openNewSocket) grace 链在 resolve 后**不再新建 socket**，并 settle
  // 在途 connect promise（否则 openNewSocket 被跳过会让 connectPromise 永久 pending、泄漏）。
  let abortConnect: ((error: Error) => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  // 探活用：最近一次收到任何入站帧的时间戳（heartbeat_ack / data / joined 都算）。
  let lastInboundAt = 0
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
    // 进入 ready 即视为刚收到入站帧（joined/handshake），从此刻起算探活窗口。
    lastInboundAt = Date.now()
    heartbeat = setInterval(() => {
      // 探活判死（dispatch 8855a45c 修复2a）：自上次入站帧超过 LIVENESS_TIMEOUT_MS → socket 半死，
      // 主动关闭它触发上层重连。注意：此 close 在 4G 上可能滞留 CLOSING，但 connectInternal 已无条件
      // detach 旧 socket handler，延迟到达的 close/1008 不会再掀翻新连接（churn 环已断）。
      const current = socket
      if (current && Date.now() - lastInboundAt > LIVENESS_TIMEOUT_MS) {
        try {
          current.close(4001, 'liveness-timeout')
        } catch {
          // close 失败也无妨：下一 tick 仍会判死，或 onclose/onerror 会接管。
        }
        return
      }
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
    }, HEARTBEAT_INTERVAL_MS)
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
    const message = decodeJson(decrypted) as JsonRpcResponse & {
      kind?: string
      payload?: unknown
      type?: string
    }
    // M27 Part B：服务器主动推送的事件帧（type:'event'，无 RPC id）→ 路由到 onEvent 监听器，
    // 不当作 RPC 回应。放在 id 匹配之前，避免事件帧（无 id）被静默丢弃。
    if (message.type === 'event' && typeof message.kind === 'string') {
      for (const listener of eventListeners) {
        listener({ kind: message.kind, payload: message.payload })
      }
      return
    }
    if (isVoiceStreamFrame(message)) {
      for (const listener of voiceStreamListeners) listener(message)
      return
    }
    if (!message.id) return
    const request = settlePending(message.id)
    if (!request) return
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
      // 本次 connect 是否已被 close() 取消。grace 链 resolve 后据此跳过 openNewSocket，绝不建 ghost socket。
      let aborted = false
      let handshake: ReturnType<typeof createHandshakeInitiator> | null = createHandshakeInitiator(
        decodeKeyPair(config.device_keypair)
      )

      const failConnect = (error: Error) => {
        if (settled) return
        settled = true
        connecting = false
        abortConnect = null
        reject(error)
      }

      // 暴露给 close() 的取消钩子：置 aborted + settle 在途 promise（防 grace 链跳过 openNewSocket 后挂死）。
      abortConnect = (error: Error) => {
        aborted = true
        failConnect(error)
      }

      const openNewSocket = () => {
        // 被 close() 取消（典型：grace 等待期间 close()）→ 绝不新建 socket，避免 ghost 连接 + 重连风暴。
        if (aborted) return
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
          // 立刻 reject 在途 RPC（HIGH 修复）：不等可能不来的 onclose，避免 in-flight RPC 泄漏到 22s 超时。
          rejectAllPending('Relay socket error')
          failConnect(event instanceof Error ? event : new Error(error))
        }

        nextSocket.onclose = (event: unknown) => {
          rejectAllPending('Relay socket closed')
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
          // 收到任何入站帧（含 relay 的 heartbeat_ack）即刷新探活时间戳。
          lastInboundAt = Date.now()
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
              abortConnect = null
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
      // 否则（首连 / 旧 socket 已 CLOSING / CLOSED）同步开新，保持原有同步建 socket 语义。
      const previousSocket = socket
      socket = null
      if (previousSocket && (previousSocket.readyState === 0 || previousSocket.readyState === 1)) {
        // CONNECTING/OPEN：closePreviousSocket 内部会先 detach 业务 handler 再关、等真正 close（或 grace）。
        void closePreviousSocket(previousSocket).then(openNewSocket)
      } else {
        // CLOSING(2)/CLOSED(3)：不能等（CLOSING 的 close 帧可能在 4G 上滞留很久），但**必须无条件
        // detach 旧 socket 的业务 handler**（dispatch 8855a45c 修复1·断 churn 环核心）。否则旧 socket
        // 延迟到达的 close/1008 'replaced' 会触发它仍挂着的 onclose → setStatus('disconnected') + 清空
        // 新 socket 的 pending → 把刚建好的活连接一起打下线 → 上层重连 → 又被 replaced → 自激 churn。
        if (previousSocket) detachSocketHandlers(previousSocket)
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

  const sendVoiceStreamFrame = (frame: VoiceStreamFrame) => {
    if (!channel || state !== 'ready') throw new Error('Relay transport not ready')
    sendFrame({
      payload: channel.encrypt(encodeJson(frame)),
      room: config.room_id,
      type: 'data',
    })
  }

  const measureVoiceStreamLatency = (
    options: VoiceStreamLatencyOptions = {}
  ): Promise<VoiceStreamLatencyResult> => {
    const count = options.count ?? 20
    const intervalMs = options.intervalMs ?? 50
    const timeoutMs = options.timeoutMs ?? 5_000
    const streamId = nextVoiceStreamId()
    const rtts: number[] = []
    let nextSeq = 1
    let finished = false
    let interval: ReturnType<typeof setInterval> | null = null
    let timeout: ReturnType<typeof setTimeout> | null = null
    return new Promise<VoiceStreamLatencyResult>((resolve, reject) => {
      const unsubscribe = (() => {
        const listener = (frame: VoiceStreamFrame) => {
          if (frame.stream_id !== streamId || frame.op !== 'ack') return
          if (typeof frame.sent_at_ms !== 'number') return
          rtts.push(Date.now() - frame.sent_at_ms)
          if (rtts.length >= count) finish()
        }
        voiceStreamListeners.add(listener)
        return () => voiceStreamListeners.delete(listener)
      })()
      const finish = () => {
        if (finished) return
        finished = true
        if (interval) clearInterval(interval)
        if (timeout) clearTimeout(timeout)
        unsubscribe()
        try {
          sendVoiceStreamFrame(createVoiceStreamFrame('close', streamId, nextSeq))
        } catch {
          // Closing the measurement stream is best-effort; the transport itself remains healthy.
        }
        resolve(calculateVoiceStreamLatency({ expectedCount: count, rtts, streamId }))
      }
      const sendPing = () => {
        if (finished || nextSeq > count) return
        try {
          sendVoiceStreamFrame(
            createVoiceStreamFrame('chunk', streamId, nextSeq, {
              payload: 'ping',
              sent_at_ms: Date.now(),
            })
          )
          nextSeq += 1
        } catch (error) {
          if (interval) clearInterval(interval)
          if (timeout) clearTimeout(timeout)
          unsubscribe()
          finished = true
          reject(error instanceof Error ? error : new Error(String(error)))
        }
        if (nextSeq > count && interval) {
          clearInterval(interval)
          interval = null
        }
      }

      try {
        sendVoiceStreamFrame(createVoiceStreamFrame('open', streamId, 0))
      } catch (error) {
        unsubscribe()
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }
      sendPing()
      interval = setInterval(sendPing, intervalMs)
      timeout = setTimeout(finish, timeoutMs)
    })
  }

  const requestVoiceStreamSynthesis = (text: string): Promise<VoiceStreamAudioResult> => {
    const streamId = nextVoiceStreamId()
    const timeoutMs = 35_000
    const reassembler = createVoiceStreamReassembler(streamId, 1)
    let finished = false
    let timeout: ReturnType<typeof setTimeout> | null = null
    return new Promise<VoiceStreamAudioResult>((resolve, reject) => {
      const cleanup = () => {
        if (timeout) clearTimeout(timeout)
        unsubscribe()
      }
      const unsubscribe = (() => {
        const listener = (frame: VoiceStreamFrame) => {
          if (frame.stream_id !== streamId) return
          if (frame.op === 'error') {
            if (finished) return
            finished = true
            cleanup()
            reject(new Error(frame.error ?? 'voice_stream synthesis failed'))
            return
          }
          const result = reassembler.accept(frame)
          if (!result || finished) return
          finished = true
          cleanup()
          resolve(result)
        }
        voiceStreamListeners.add(listener)
        return () => voiceStreamListeners.delete(listener)
      })()
      timeout = setTimeout(() => {
        if (finished) return
        finished = true
        cleanup()
        reject(new Error('voice_stream synthesis timed out'))
      }, timeoutMs)

      try {
        sendVoiceStreamFrame(createVoiceStreamFrame('open', streamId, 0, { text }))
      } catch (error) {
        finished = true
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  return {
    call<T>(method: string, params?: unknown) {
      if (!channel || state !== 'ready')
        return Promise.reject(new Error('Relay transport not ready'))
      const id = `rpc-${Date.now()}-${rpcCounter++}`
      const payload = channel.encrypt(encodeJson({ id, jsonrpc: '2.0', method, params }))
      return new Promise<T>((resolve, reject) => {
        // 半死 socket 兜底：超时未收到响应即 reject + 清 pending，绝不无限挂起（见 RPC_TIMEOUT_MS）。
        // dispatch 8855a45c 修复2a：**只 reject，不再关 socket**。旧实现一超时就 close(4000)，在 4G 上
        // 高频超时 → 反复关连接 → churn 环（见 connectInternal 注释）。「socket 是否真死」改由心跳探活
        // （startHeartbeat 的 lastInboundAt 判定，~45s 零入站才关）统一裁决，单条慢 RPC 不再拖垮整条连接。
        const timer = setTimeout(() => {
          if (!pending.delete(id)) return
          reject(new Error(`Relay RPC timed out: ${method}`))
        }, RPC_TIMEOUT_MS)
        pending.set(id, { reject, resolve: (value) => resolve(value as T), timer })
        try {
          sendFrame({ payload, room: config.room_id, type: 'data' })
        } catch (error) {
          if (pending.delete(id)) clearTimeout(timer)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    },
    close() {
      // 先取消在途 connect：若正卡在换 socket 的 grace 等待，阻止它 resolve 后建 ghost socket，并 settle
      // 其 promise（防 connectPromise 永久 pending）。abortConnect 为空（无在途 connect）则 no-op。
      abortConnect?.(new Error('Relay transport closed'))
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
    measureVoiceStreamLatency,
    onDiagnosticsEvent(cb) {
      diagnosticsListeners.add(cb)
      return () => diagnosticsListeners.delete(cb)
    },
    onEvent(cb) {
      eventListeners.add(cb)
      return () => eventListeners.delete(cb)
    },
    onStatusChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    onVoiceStreamFrame(cb) {
      voiceStreamListeners.add(cb)
      return () => voiceStreamListeners.delete(cb)
    },
    requestVoiceStreamSynthesis,
    sendVoiceStreamFrame,
    status() {
      return state
    },
  }
}
