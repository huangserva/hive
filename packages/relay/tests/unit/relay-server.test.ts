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
  } = {}
) => {
  const server = createRelayServer({
    host: '127.0.0.1',
    port: 0,
    authToken: options.authToken ?? 'secret',
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 30_000,
    roomIdleTimeoutMs: options.roomIdleTimeoutMs ?? 5 * 60_000,
    cleanupIntervalMs: options.cleanupIntervalMs ?? 30_000,
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

  it('rejects a second daemon in the same room', async () => {
    const server = await startRelay()
    const firstDaemon = await connect(server)
    const secondDaemon = await connect(server)

    await joinRoom(firstDaemon, 'room-duplicate', 'daemon')
    sendJson(secondDaemon, {
      type: 'join',
      room: 'room-duplicate',
      role: 'daemon',
      auth_token: 'secret',
    })

    await expect(nextMessage(secondDaemon)).resolves.toMatchObject({
      type: 'error',
      code: 'role_occupied',
    })
  })
})
