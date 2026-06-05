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
import { isWebRtcSignalFrame, type WebRtcSignalFrame } from './webrtc-signal-protocol.js'

import type { HiveLogger } from './logger.js'

const log = (message: string, error?: unknown) => {
  const ts = new Date().toISOString()
  const suffix = error
    ? ` error=${error instanceof Error ? error.message : String(error)}`
    : ''
  process.stderr.write(`[relay-connector ${ts}] ${message}${suffix}\n`)
}

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
  // M27 Part B：往所有已鉴权设备 session 主动推一帧加密事件（type:'event'，无 RPC id），
  // 治 app 5s 轮询延迟。复用现有 channel.encrypt，relay 只转发密文。无 session 时 no-op。
  pushEvent(kind: string, payload: unknown): void
  close(): void
}

export type RpcHandler = (
  method: string,
  params: unknown,
  deviceId: string,
  capabilities: string[]
) => Promise<unknown>

export interface RelayConnectorOptions {
  authenticateDevice?: (token: string) => { capabilities: string[]; id: string }
  heartbeatIntervalMs?: number
  // 探活超时：在此时长内未从对端收到**任何**帧（含 heartbeat_ack）→ 判连接死（半开 socket）→
  // terminate 触发重连。默认 = 2×心跳间隔 + 5s 余量（容忍正常网络抖动的丢 1~2 拍），可注入用于测试。
  livenessTimeoutMs?: number
  reconnectBaseDelayMs?: number
  reconnectMaxDelayMs?: number
  // 测试注入用的 WebSocket 构造器（默认 ws 的 WebSocket）。
  WebSocketCtor?: new (
    url: string
  ) => WebSocket
  voiceStreamHandler?: (
    frame: VoiceStreamFrame,
    context: {
      capabilities: string[]
      deviceId: string
      send: (frame: VoiceStreamFrame) => void
    }
  ) => Promise<boolean> | boolean
  webrtcSignalHandler?: (
    frame: WebRtcSignalFrame,
    context: {
      capabilities: string[]
      deviceId: string
      send: (frame: WebRtcSignalFrame) => void
    }
  ) => Promise<boolean> | boolean
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

export interface VoiceStreamFrame {
  done?: boolean
  error?: string
  format?: string
  mime?: string
  op?: string
  payload?: string
  sent_at_ms?: number
  seq?: number
  stream_id?: string
  text?: string
  type?: string
  voice?: string
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000
const DEFAULT_RECONNECT_BASE_DELAY_MS = 1_000
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000
const VOICE_STREAM_OPERATIONS = new Set(['ack', 'chunk', 'close', 'error', 'open'])

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

const isVoiceStreamFrame = (value: unknown): value is VoiceStreamFrame => {
  if (typeof value !== 'object' || value === null) return false
  const frame = value as VoiceStreamFrame
  return (
    frame.type === 'voice_stream' &&
    typeof frame.stream_id === 'string' &&
    frame.stream_id.length > 0 &&
    typeof frame.seq === 'number' &&
    Number.isInteger(frame.seq) &&
    frame.seq >= 0 &&
    typeof frame.op === 'string' &&
    VOICE_STREAM_OPERATIONS.has(frame.op)
  )
}

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
  // 最近一次从对端收到任意帧的时刻。探活基准：心跳 tick 时若 now-lastInboundAt 超阈值即判死。
  let lastInboundAt = Date.now()
  const sessions = new Map<string, RelayDeviceSession>()

  const WebSocketCtor = options.WebSocketCtor ?? WebSocket
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
  const livenessTimeoutMs = options.livenessTimeoutMs ?? heartbeatIntervalMs * 2 + 5_000
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
      // 探活（根因修复 ①）：半开 socket 下对端不再回任何帧（heartbeat_ack/data），readyState 仍 OPEN、
      // 旧实现永远当自己活着 → 成 relay room 里的僵尸。这里若超 livenessTimeoutMs 没收到任何入站帧，
      // 判连接死 → terminate（→ onclose → sessions.clear + scheduleReconnect → 重 join，relay newest-wins
      // 顶掉僵尸槽，daemon 侧自愈，不必重启 4010）。
      if (Date.now() - lastInboundAt > livenessTimeoutMs) {
        status = {
          ...status,
          last_error: 'Relay liveness timeout: no frames from peer',
          mode: 'error',
        }
        const dead = socket
        socket = null
        if (dead) {
          try {
            dead.terminate()
          } catch {
            dead.close()
          }
        }
        return
      }
      sendRelayFrame({ type: 'heartbeat' })
    }, heartbeatIntervalMs)
    heartbeatTimer.unref?.()
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
    reconnectTimer.unref?.()
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

  // stale channel 守卫（bug ③c）：仅当该会话仍是当前注册的活跃会话时才发响应。
  // 断连会 sessions.clear()、重新握手会替换同 deviceId 的会话——两种情况下，
  // 在途 async 响应若仍用旧 channel 加密并发到（可能已是新的）socket 就会用过期密钥 / 发错连接，
  // 因此一旦会话身份不再匹配就直接丢弃，不发送。
  const sendEncryptedResponse = (session: RelayDeviceSession, body: unknown) => {
    if (sessions.get(session.deviceId) !== session) return
    sendRelayFrame({
      payload: session.channel.encrypt(encodeJson(body)),
      type: 'data',
    })
  }

  const handleVoiceStreamFrame = async (session: RelayDeviceSession, frame: unknown) => {
    if (!isVoiceStreamFrame(frame)) return false
    if (
      options.voiceStreamHandler &&
      (await options.voiceStreamHandler(frame, {
        capabilities: session.capabilities,
        deviceId: session.deviceId,
        send: (outbound) => sendEncryptedResponse(session, outbound),
      }))
    ) {
      return true
    }
    if (frame.op === 'close') return true
    sendEncryptedResponse(session, {
      op: 'ack',
      payload: frame.op === 'chunk' ? 'pong' : undefined,
      sent_at_ms: frame.sent_at_ms,
      seq: frame.seq,
      stream_id: frame.stream_id,
      type: 'voice_stream',
    })
    return true
  }

  const handleWebRtcSignalFrame = async (session: RelayDeviceSession, frame: unknown) => {
    if (!isWebRtcSignalFrame(frame)) return false
    log(`WebRTC signal received: kind=${frame.kind} call_id=${frame.call_id} device=${session.deviceId}`)
    if (!session.capabilities.includes('send_prompt')) {
      log(`WebRTC signal rejected: no send_prompt capability, sending bye`)
      sendEncryptedResponse(session, {
        call_id: frame.call_id,
        kind: 'bye',
        type: 'webrtc_signal',
      })
      return true
    }
    if (
      options.webrtcSignalHandler &&
      (await options.webrtcSignalHandler(frame, {
        capabilities: session.capabilities,
        deviceId: session.deviceId,
        send: (outbound) => {
          const out = outbound as unknown as Record<string, unknown>
          log(`WebRTC signal sending: kind=${out.kind} call_id=${out.call_id ?? frame.call_id} candidate=${out.candidate ? 'present' : 'none'}`)
          return sendEncryptedResponse(session, outbound)
        },
      }))
    ) {
      return true
    }
    if (frame.kind === 'bye') return true
    sendEncryptedResponse(session, {
      call_id: frame.call_id,
      kind: 'bye',
      type: 'webrtc_signal',
    })
    return true
  }

  const handleEncryptedRpc = async (payload: string) => {
    for (const session of sessions.values()) {
      // 畸形 base64 会让 decrypt 内部的 atob 抛错（bug ③a）；逐会话捕获后继续尝试下一个会话，
      // 任何畸形输入都不让异常冒泡出本函数（否则 line 274 的 void 调用会变成 unhandled rejection → process.exit）。
      let plaintext: Uint8Array | null
      try {
        plaintext = session.channel.decrypt(payload)
      } catch {
        continue
      }
      if (!plaintext) continue

      // 解密成功 = 命中正确会话。后续畸形输入一律优雅回标准 JSON-RPC error，不再 throw（bug ③a/③b）。
      let request: unknown
      try {
        request = decodeJson(plaintext)
      } catch {
        // JSON 畸形：取不到 id，按 JSON-RPC 规范回 -32700 Parse error（id 为 null）。
        sendEncryptedResponse(session, {
          error: { code: -32700, message: 'Parse error' },
          id: null,
          jsonrpc: '2.0',
        })
        return
      }

      if (await handleVoiceStreamFrame(session, request)) return
      if (await handleWebRtcSignalFrame(session, request)) return

      const rpcRequest = request as { id?: string; method?: string; params?: unknown }
      const id = rpcRequest.id ?? null
      if (typeof rpcRequest.method !== 'string') {
        sendEncryptedResponse(session, {
          error: { code: -32600, message: 'Invalid Request' },
          id,
          jsonrpc: '2.0',
        })
        return
      }

      try {
        const result = await rpcHandler(
          rpcRequest.method,
          rpcRequest.params ?? {},
          session.deviceId,
          session.capabilities
        )
        sendEncryptedResponse(session, { id, jsonrpc: '2.0', result })
      } catch (error) {
        sendEncryptedResponse(session, { error: normalizeRpcError(error), id, jsonrpc: '2.0' })
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
    // 防御性兜底：handleEncryptedRpc 内部已捕获所有畸形输入，这里再加 .catch 确保任何意外异常
    // 都不会变成 unhandled rejection 触发全局 handler 的 process.exit（bug ③a）。
    void handleEncryptedRpc(frame.payload).catch(() => {})
  }

  function connect() {
    if (closed || !config.enabled) return
    status = {
      ...status,
      last_error: null,
      mode: 'connecting',
    }
    // 新连接：探活基准重置为现在，避免握手期就被判死。
    lastInboundAt = Date.now()
    socket = new WebSocketCtor(config.relay_url)
    socket.on('open', () => {
      sendRelayFrame({
        auth_token: config.relay_auth_token,
        role: 'daemon',
        room: config.room_id,
        type: 'join',
      })
    })
    socket.on('message', (data) => {
      // 收到任意帧即证明连接还活着，刷新探活基准（①）。
      lastInboundAt = Date.now()
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
    pushEvent(kind: string, payload: unknown) {
      // 给每个活跃 session 用其会话密钥各加密一份；事件帧无 id，设备端按 type:'event' 路由到
      // onEvent，不会被误当 RPC 回应。socket 未连或无 session 自然 no-op（sendRelayFrame 守 OPEN）。
      for (const session of sessions.values()) {
        sendEncryptedResponse(session, { kind, payload, type: 'event' })
      }
    },
    status() {
      return { ...status }
    },
  }
}
