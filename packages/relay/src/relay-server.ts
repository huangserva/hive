import { createServer } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'

export type RelayRole = 'daemon' | 'device'

export interface RelayServerOptions {
  host?: string
  port?: number
  authToken?: string
  heartbeatIntervalMs?: number
  roomIdleTimeoutMs?: number
  cleanupIntervalMs?: number
  // 单 peer 探活超时：某 peer 在此时长内没发过任何帧（含 heartbeat）→ 视为死连接驱逐、释放它占的
  // daemon/device 槽（根因修复 ②）。比 room 空闲(默认 5min)快，且只踢死 peer 不影响活 room。
  peerIdleTimeoutMs?: number
}

export interface RelayServerHandle {
  readonly port: number
  readonly ready: Promise<void>
  close(): Promise<void>
  roomCount(): number
}

type JoinedPeer = {
  ws: WebSocket
  room: string
  role: RelayRole
  lastSeenAt: number
}

type RelayRoom = {
  daemon?: JoinedPeer
  device?: JoinedPeer
  lastActivityAt: number
}

type RelayFrame =
  | { type: 'join'; room: string; role: RelayRole; auth_token?: string }
  | { type: 'data'; payload: string }
  | { type: 'heartbeat' }
  | { type: 'leave' }

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000
const DEFAULT_ROOM_IDLE_TIMEOUT_MS = 5 * 60_000
const DEFAULT_CLEANUP_INTERVAL_MS = 30_000
// 默认 60s：daemon/device 都每 ~20s 发一次心跳，60s 容忍丢 2 拍 + 余量；死 peer 60s 内被驱逐。
const DEFAULT_PEER_IDLE_TIMEOUT_MS = 60_000

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const sendJson = (ws: WebSocket, frame: unknown) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(frame))
  }
}

const parseFrame = (data: WebSocket.RawData): RelayFrame | null => {
  try {
    const parsed = JSON.parse(data.toString()) as unknown
    if (!isObject(parsed) || typeof parsed.type !== 'string') {
      return null
    }
    return parsed as RelayFrame
  } catch {
    return null
  }
}

const getPeerSlot = (room: RelayRoom, role: RelayRole) => {
  return role === 'daemon' ? room.daemon : room.device
}

const setPeerSlot = (room: RelayRoom, role: RelayRole, peer: JoinedPeer | undefined) => {
  if (role === 'daemon') {
    room.daemon = peer
  } else {
    room.device = peer
  }
}

const getOtherPeer = (room: RelayRoom, role: RelayRole) => {
  return role === 'daemon' ? room.device : room.daemon
}

export const createRelayServer = (options: RelayServerOptions = {}): RelayServerHandle => {
  const rooms = new Map<string, RelayRoom>()
  const peers = new Map<WebSocket, JoinedPeer>()
  const connections = new Set<WebSocket>()
  const httpServer = createServer()
  const webSocketServer = new WebSocketServer({ server: httpServer })
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
  const roomIdleTimeoutMs = options.roomIdleTimeoutMs ?? DEFAULT_ROOM_IDLE_TIMEOUT_MS
  const cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS
  const peerIdleTimeoutMs = options.peerIdleTimeoutMs ?? DEFAULT_PEER_IDLE_TIMEOUT_MS

  const touchRoom = (room: RelayRoom) => {
    room.lastActivityAt = Date.now()
  }

  const removePeer = (ws: WebSocket, notifyPeer: boolean) => {
    const peer = peers.get(ws)
    if (!peer) {
      return
    }

    peers.delete(ws)
    const room = rooms.get(peer.room)
    if (!room) {
      return
    }

    setPeerSlot(room, peer.role, undefined)
    touchRoom(room)

    if (notifyPeer) {
      const otherPeer = getOtherPeer(room, peer.role)
      if (otherPeer) {
        sendJson(otherPeer.ws, { type: 'peer_disconnected', role: peer.role })
      }
    }

    if (!room.daemon && !room.device) {
      rooms.delete(peer.room)
    }
  }

  const reject = (ws: WebSocket, code: string, message: string) => {
    sendJson(ws, { type: 'error', code, message })
    ws.close(1008, code)
  }

  const handleJoin = (ws: WebSocket, frame: RelayFrame) => {
    if (frame.type !== 'join') {
      reject(ws, 'not_joined', 'Join a room before sending relay frames')
      return
    }
    if (peers.has(ws)) {
      reject(ws, 'already_joined', 'Socket already joined a room')
      return
    }
    if (typeof frame.room !== 'string' || frame.room.trim().length === 0) {
      reject(ws, 'invalid_room', 'Room is required')
      return
    }
    if (frame.role !== 'daemon' && frame.role !== 'device') {
      reject(ws, 'invalid_role', 'Role must be daemon or device')
      return
    }
    if (options.authToken && frame.auth_token !== options.authToken) {
      reject(ws, 'unauthorized', 'Invalid relay auth token')
      return
    }

    const room = rooms.get(frame.room) ?? { lastActivityAt: Date.now() }
    rooms.set(frame.room, room)

    const existing = getPeerSlot(room, frame.role)
    if (existing) {
      // A newer connection for the same role replaces the stale one. Mobile apps
      // (reopen / foreground / network change) and the runtime (4010 restart) open
      // a fresh socket while the previous one can linger as a zombie behind a proxy
      // and would otherwise hold the slot forever — rejecting every reconnect with
      // role_occupied. Newest connection wins; the daemon re-keys its e2ee session
      // by device_id when the new device sends its hello. We delete the old peer
      // from `peers` BEFORE closing it so the async close handler's removePeer is a
      // no-op and can't wipe the slot we're about to hand to the new connection.
      peers.delete(existing.ws)
      sendJson(existing.ws, {
        type: 'error',
        code: 'replaced',
        message: `Replaced by a newer ${frame.role} connection`,
      })
      existing.ws.close(1008, 'replaced')
    }

    const peer: JoinedPeer = { ws, room: frame.room, role: frame.role, lastSeenAt: Date.now() }
    setPeerSlot(room, frame.role, peer)
    peers.set(ws, peer)
    touchRoom(room)
    sendJson(ws, { type: 'joined', room: frame.room, role: frame.role })
  }

  const handleJoinedFrame = (ws: WebSocket, peer: JoinedPeer, frame: RelayFrame) => {
    const room = rooms.get(peer.room)
    if (!room) {
      reject(ws, 'room_missing', 'Room no longer exists')
      return
    }
    touchRoom(room)
    peer.lastSeenAt = Date.now() // 任意帧刷新 peer 探活基准（②）

    if (frame.type === 'data') {
      if (typeof frame.payload !== 'string') {
        reject(ws, 'invalid_payload', 'Data payload must be a string')
        return
      }
      const otherPeer = getOtherPeer(room, peer.role)
      if (otherPeer) {
        sendJson(otherPeer.ws, { type: 'data', payload: frame.payload })
      }
      return
    }

    if (frame.type === 'heartbeat') {
      sendJson(ws, { type: 'heartbeat_ack' })
      return
    }

    if (frame.type === 'leave') {
      sendJson(ws, { type: 'left' })
      removePeer(ws, true)
      ws.close(1000, 'leave')
      return
    }

    reject(ws, 'invalid_frame', 'Unsupported relay frame')
  }

  webSocketServer.on('connection', (ws) => {
    connections.add(ws)

    ws.on('message', (data) => {
      const frame = parseFrame(data)
      if (!frame) {
        reject(ws, 'invalid_json', 'Invalid JSON relay frame')
        return
      }

      const peer = peers.get(ws)
      if (!peer) {
        handleJoin(ws, frame)
        return
      }
      handleJoinedFrame(ws, peer, frame)
    })

    ws.on('close', () => {
      connections.delete(ws)
      removePeer(ws, true)
    })
  })

  const heartbeatTimer = setInterval(() => {
    for (const ws of peers.keys()) {
      sendJson(ws, { type: 'heartbeat' })
    }
  }, heartbeatIntervalMs)
  heartbeatTimer.unref()

  const cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [roomName, room] of rooms.entries()) {
      // ② 先驱逐"静默死 peer"（半开 socket）：释放它占的 daemon/device 槽，让对端重连能顶上。
      // 删 peers + 清槽 + 通知对端 + terminate；先 peers.delete 再 terminate，使 close 处理器的 removePeer
      // 成 no-op、不重复通知（沿用 newest-wins evict 的顺序约定）。
      for (const peer of [room.daemon, room.device]) {
        if (peer && now - peer.lastSeenAt > peerIdleTimeoutMs) {
          const otherPeer = getOtherPeer(room, peer.role)
          if (otherPeer) {
            sendJson(otherPeer.ws, { type: 'peer_disconnected', role: peer.role })
          }
          peers.delete(peer.ws)
          setPeerSlot(room, peer.role, undefined)
          try {
            peer.ws.terminate()
          } catch {
            peer.ws.close(1000, 'peer_idle_timeout')
          }
        }
      }
      if (!room.daemon && !room.device) {
        rooms.delete(roomName)
        continue
      }
      // room 空闲清理（保留原 5min 逻辑）。
      if (now - room.lastActivityAt < roomIdleTimeoutMs) {
        continue
      }
      for (const peer of [room.daemon, room.device]) {
        if (peer) {
          sendJson(peer.ws, { type: 'room_expired' })
          peers.delete(peer.ws)
          peer.ws.close(1000, 'room_expired')
        }
      }
      rooms.delete(roomName)
    }
  }, cleanupIntervalMs)
  cleanupTimer.unref()

  const ready = new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      httpServer.off('error', reject)
      resolve()
    })
  })

  return {
    get port() {
      const address = httpServer.address()
      if (typeof address === 'object' && address) {
        return address.port
      }
      return options.port ?? 0
    },
    ready,
    roomCount: () => rooms.size,
    close: async () => {
      clearInterval(heartbeatTimer)
      clearInterval(cleanupTimer)
      for (const ws of connections) {
        ws.terminate()
      }
      await new Promise<void>((resolve, reject) => {
        webSocketServer.close((wsError) => {
          if (wsError) {
            reject(wsError)
            return
          }
          httpServer.close((httpError) => {
            if (
              httpError &&
              (httpError as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING'
            ) {
              reject(httpError)
              return
            }
            resolve()
          })
        })
      })
    },
  }
}
