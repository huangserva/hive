import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { createRelayServer, type RelayServerHandle } from '../../src/relay-server.js'

const servers: RelayServerHandle[] = []
const sockets: WebSocket[] = []

const startRelay = async (
  options: {
    authToken?: string
    heartbeatIntervalMs?: number
    roomIdleTimeoutMs?: number
    cleanupIntervalMs?: number
    peerIdleTimeoutMs?: number
  } = {}
) => {
  const server = createRelayServer({
    host: '127.0.0.1',
    port: 0,
    authToken: options.authToken ?? 'secret',
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 30_000,
    roomIdleTimeoutMs: options.roomIdleTimeoutMs ?? 5 * 60_000,
    cleanupIntervalMs: options.cleanupIntervalMs ?? 30_000,
    ...(options.peerIdleTimeoutMs !== undefined
      ? { peerIdleTimeoutMs: options.peerIdleTimeoutMs }
      : {}),
  })
  servers.push(server)
  await server.ready
  return server
}

const connect = async (server: RelayServerHandle) => {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}`)
  sockets.push(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return socket
}

const sendJson = (socket: WebSocket, frame: unknown) => {
  socket.send(JSON.stringify(frame))
}

const nextMessage = async <T>(socket: WebSocket): Promise<T> => {
  return await new Promise<T>((resolve) => {
    socket.once('message', (data) => {
      resolve(JSON.parse(data.toString()) as T)
    })
  })
}

const joinRoom = async (
  socket: WebSocket,
  room: string,
  role: 'daemon' | 'device',
  authToken = 'secret'
) => {
  sendJson(socket, { type: 'join', room, role, auth_token: authToken })
  await expect(nextMessage(socket)).resolves.toMatchObject({ type: 'joined', room, role })
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close()
    }
  }
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

describe('relay server', () => {
  it('pairs daemon and device in a room and forwards opaque data payloads', async () => {
    const server = await startRelay()
    const daemon = await connect(server)
    const device = await connect(server)

    await joinRoom(daemon, 'room-a', 'daemon')
    await joinRoom(device, 'room-a', 'device')

    sendJson(device, { type: 'data', payload: 'YmFzZTY0LWNpcGhlcnRleHQ=' })

    await expect(nextMessage(daemon)).resolves.toEqual({
      type: 'data',
      payload: 'YmFzZTY0LWNpcGhlcnRleHQ=',
    })
  })

  it('acknowledges heartbeat frames', async () => {
    const server = await startRelay()
    const daemon = await connect(server)

    await joinRoom(daemon, 'room-heartbeat', 'daemon')
    sendJson(daemon, { type: 'heartbeat' })

    await expect(nextMessage(daemon)).resolves.toEqual({ type: 'heartbeat_ack' })
  })

  it('notifies a device when the daemon disconnects', async () => {
    const server = await startRelay()
    const daemon = await connect(server)
    const device = await connect(server)

    await joinRoom(daemon, 'room-disconnect', 'daemon')
    await joinRoom(device, 'room-disconnect', 'device')

    daemon.close()

    await expect(nextMessage(device)).resolves.toEqual({
      type: 'peer_disconnected',
      role: 'daemon',
    })
  })

  // P0+ 根因修复 ②：半开死 peer（app 层心跳/数据帧停了、socket 没正常 close）会永远占着 room 的
  // daemon/device 槽 → 手机消息被转发给死连接静默丢弃、重登也救不回。per-peer 探活按"最近收帧时间"
  // 驱逐静默 peer、释放槽，让对端重连能顶上。
  it('evicts a silent peer past peerIdleTimeoutMs and frees its room slot (root-cause fix ②)', async () => {
    const server = await startRelay({
      peerIdleTimeoutMs: 150,
      cleanupIntervalMs: 40,
      heartbeatIntervalMs: 30_000,
      roomIdleTimeoutMs: 30_000,
    })
    const daemon = await connect(server)
    await joinRoom(daemon, 'room-evict', 'daemon')
    expect(server.roomCount()).toBe(1)

    // daemon 之后不发任何帧（模拟半开 socket）→ 在 peerIdleTimeoutMs 后被驱逐、socket 被 terminate。
    await new Promise<void>((resolve) => daemon.once('close', () => resolve()))
    expect(server.roomCount()).toBe(0) // 槽释放、room 清空
  })

  it('does NOT evict a peer that keeps sending frames within the window (root-cause fix ②)', async () => {
    const server = await startRelay({
      peerIdleTimeoutMs: 250,
      cleanupIntervalMs: 50,
      heartbeatIntervalMs: 30_000,
      roomIdleTimeoutMs: 30_000,
    })
    const daemon = await connect(server)
    await joinRoom(daemon, 'room-keep', 'daemon')

    // 每 80ms 发一次心跳（< 250ms 阈值）→ lastSeenAt 持续刷新 → 不该被驱逐。
    const beat = setInterval(() => {
      if (daemon.readyState === WebSocket.OPEN) sendJson(daemon, { type: 'heartbeat' })
    }, 80)
    await new Promise((resolve) => setTimeout(resolve, 400))
    clearInterval(beat)

    expect(daemon.readyState).toBe(WebSocket.OPEN)
    expect(server.roomCount()).toBe(1)
  })

  it('rejects clients with an invalid auth token', async () => {
    const server = await startRelay()
    const daemon = await connect(server)

    sendJson(daemon, { type: 'join', room: 'room-auth', role: 'daemon', auth_token: 'wrong' })

    await expect(nextMessage(daemon)).resolves.toMatchObject({
      type: 'error',
      code: 'unauthorized',
    })
  })

  it('expires idle rooms', async () => {
    const server = await startRelay({
      roomIdleTimeoutMs: 25,
      cleanupIntervalMs: 5,
      heartbeatIntervalMs: 1_000,
    })
    const daemon = await connect(server)

    await joinRoom(daemon, 'room-timeout', 'daemon')

    await expect(nextMessage(daemon)).resolves.toEqual({ type: 'room_expired' })
    expect(server.roomCount()).toBe(0)
  })

  it('replaces a stale device with a newer connection and rewires it to the daemon', async () => {
    const server = await startRelay()
    const daemon = await connect(server)
    const firstDevice = await connect(server)

    await joinRoom(daemon, 'room-replace', 'daemon')
    await joinRoom(firstDevice, 'room-replace', 'device')

    // The first device socket goes stale (e.g. the mobile app was reopened and the
    // old socket lingers as a zombie behind a proxy). A fresh device socket joins
    // the same room and must take over the slot instead of being rejected.
    const secondDevice = await connect(server)
    sendJson(secondDevice, {
      type: 'join',
      room: 'room-replace',
      role: 'device',
      auth_token: 'secret',
    })

    // Old device is evicted...
    await expect(nextMessage(firstDevice)).resolves.toMatchObject({
      type: 'error',
      code: 'replaced',
    })
    // ...and the new device is admitted.
    await expect(nextMessage(secondDevice)).resolves.toMatchObject({
      type: 'joined',
      room: 'room-replace',
      role: 'device',
    })

    // The new device is wired to the daemon end-to-end: its data forwards through.
    sendJson(secondDevice, { type: 'data', payload: 'cmVrZXk=' })
    await expect(nextMessage(daemon)).resolves.toEqual({ type: 'data', payload: 'cmVrZXk=' })
  })

  it('replaces a stale daemon with a newer connection (runtime restart)', async () => {
    const server = await startRelay()
    const firstDaemon = await connect(server)
    const secondDaemon = await connect(server)

    await joinRoom(firstDaemon, 'room-daemon-restart', 'daemon')
    sendJson(secondDaemon, {
      type: 'join',
      room: 'room-daemon-restart',
      role: 'daemon',
      auth_token: 'secret',
    })

    await expect(nextMessage(firstDaemon)).resolves.toMatchObject({
      type: 'error',
      code: 'replaced',
    })
    await expect(nextMessage(secondDaemon)).resolves.toMatchObject({
      type: 'joined',
      room: 'room-daemon-restart',
      role: 'daemon',
    })

    // A device joining now reaches the NEW daemon, not the evicted one.
    const device = await connect(server)
    await joinRoom(device, 'room-daemon-restart', 'device')
    sendJson(device, { type: 'data', payload: 'aGVsbG8=' })
    await expect(nextMessage(secondDaemon)).resolves.toEqual({ type: 'data', payload: 'aGVsbG8=' })
  })

  it('removes an evicted replaced peer from its room before admitting the replacement', async () => {
    const server = await startRelay()
    const firstDevice = await connect(server)
    const secondDevice = await connect(server)

    await joinRoom(firstDevice, 'room-replaced-device-only', 'device')
    expect(server.roomPeerCount('room-replaced-device-only')).toBe(1)

    sendJson(secondDevice, {
      type: 'join',
      room: 'room-replaced-device-only',
      role: 'device',
      auth_token: 'secret',
    })

    await expect(nextMessage(firstDevice)).resolves.toMatchObject({
      type: 'error',
      code: 'replaced',
    })
    await expect(nextMessage(secondDevice)).resolves.toMatchObject({
      type: 'joined',
      room: 'room-replaced-device-only',
      role: 'device',
    })
    expect(server.roomPeerCount('room-replaced-device-only')).toBe(1)
  })
})
