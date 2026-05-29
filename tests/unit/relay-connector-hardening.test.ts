import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer, type WebSocket as WsSocket } from 'ws'

import {
  createHandshakeInitiator,
  decodeBase64,
  decodeJson,
  type EncryptedChannel,
  encodeBase64,
  encodeJson,
  generateKeyPair,
} from '../../packages/relay-crypto/src/index.js'
import {
  createRelayConnector,
  type RelayConfig,
  type RelayConnectorHandle,
} from '../../src/server/relay-connector.js'

// 这些用例针对 relay-connector 的 3 个高危 bug（崩溃 / 未处理 rejection / stale channel）。
// 为了能确定性地驱动「断连后重连」并精确捕获 connector 实际发出的帧，
// 这里用一个最小的假 relay（裸 ws.Server），由测试同时扮演 relay 与 device 两端。

interface FakeConnection {
  socket: WsSocket
  // connector 发出的 data 帧（已过滤掉 join/heartbeat 噪声）
  nextData: () => Promise<{ payload: string; type: string }>
  dataCount: () => number
}

interface FakeRelay {
  port: number
  waitForConnection: (index: number) => Promise<FakeConnection>
  closeConnection: (index: number) => void
  close: () => Promise<void>
}

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

const startFakeRelay = async (): Promise<FakeRelay> => {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  const connections: FakeConnection[] = []
  const connectionWaiters = new Map<number, Array<(conn: FakeConnection) => void>>()

  wss.on('connection', (socket) => {
    const dataQueue: Array<{ payload: string; type: string }> = []
    const dataWaiters: Array<(frame: { payload: string; type: string }) => void> = []

    const conn: FakeConnection = {
      socket,
      dataCount: () => dataQueue.length,
      nextData: () =>
        new Promise((resolve) => {
          const queued = dataQueue.shift()
          if (queued) resolve(queued)
          else dataWaiters.push(resolve)
        }),
    }

    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as { type: string; payload?: string }
      // connector 上线即发 join：回 joined 让它进入 connected。
      if (frame.type === 'join') {
        socket.send(JSON.stringify({ type: 'joined' }))
        return
      }
      // 过滤心跳噪声，只把 data 帧交给测试。
      if (frame.type === 'heartbeat' || frame.type === 'heartbeat_ack') return
      const dataFrame = frame as { payload: string; type: string }
      const waiter = dataWaiters.shift()
      if (waiter) waiter(dataFrame)
      else dataQueue.push(dataFrame)
    })

    const index = connections.length
    connections.push(conn)
    for (const waiter of connectionWaiters.get(index) ?? []) waiter(conn)
    connectionWaiters.delete(index)
  })

  await new Promise<void>((resolve) => wss.on('listening', () => resolve()))
  const port = (wss.address() as AddressInfo).port

  return {
    port,
    waitForConnection: (index) => {
      const existing = connections[index]
      if (existing) return Promise.resolve(existing)
      const { promise, resolve } = deferred<FakeConnection>()
      const waiters = connectionWaiters.get(index) ?? []
      waiters.push(resolve)
      connectionWaiters.set(index, waiters)
      return promise
    },
    closeConnection: (index) => {
      connections[index]?.socket.close()
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const conn of connections) conn.socket.terminate()
        wss.close(() => resolve())
      }),
  }
}

const relays: FakeRelay[] = []
const connectors: RelayConnectorHandle[] = []

const configForPort = (port: number): RelayConfig => ({
  daemon_keypair: generateKeyPair(),
  enabled: true,
  relay_auth_token: 'relay-secret',
  relay_url: `ws://127.0.0.1:${port}`,
  room_id: 'room-1',
  runtime_id: 'runtime-1',
})

const sendData = (conn: FakeConnection, payload: string) => {
  conn.socket.send(JSON.stringify({ payload, type: 'data' }))
}

// 测试扮演 device，对某条连接完成 E2EE 握手，返回可用于加解密的 channel。
const handshakeAsDevice = async (conn: FakeConnection): Promise<EncryptedChannel> => {
  const initiator = createHandshakeInitiator(generateKeyPair())
  sendData(
    conn,
    encodeBase64(
      encodeJson({
        capabilities: ['read_dashboard'],
        device_id: 'device-1',
        handshake: initiator.getInitMessage(),
        token: 'device-token',
        type: 'e2ee_hello',
      })
    )
  )
  const readyFrame = await conn.nextData()
  const ready = decodeJson(decodeBase64(readyFrame.payload)) as {
    handshake: { ephemeral_public_key: string }
    type: string
  }
  expect(ready.type).toBe('e2ee_ready')
  return initiator.processResponse(ready.handshake)
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

afterEach(async () => {
  for (const connector of connectors.splice(0)) connector.close()
  await Promise.all(relays.splice(0).map((relay) => relay.close()))
})

describe('relay connector hardening', () => {
  it('③a/③b: malformed JSON / non-string method does not crash and returns JSON-RPC errors', async () => {
    const rejections: unknown[] = []
    const onRejection = (reason: unknown) => rejections.push(reason)
    process.on('unhandledRejection', onRejection)

    try {
      const relay = await startFakeRelay()
      relays.push(relay)
      const connector = createRelayConnector(
        configForPort(relay.port),
        async (method, params) => ({ method, ok: true, params }),
        {
          authenticateDevice: () => ({ capabilities: ['read_dashboard'], id: 'device-1' }),
          heartbeatIntervalMs: 10_000,
          reconnectBaseDelayMs: 10,
        }
      )
      connectors.push(connector)

      const conn = await relay.waitForConnection(0)
      const channel = await handshakeAsDevice(conn)

      // ① 解密成功但 JSON 畸形 —— 旧代码会在 try/catch 外 throw → unhandled rejection → 崩溃。
      sendData(conn, channel.encrypt(new TextEncoder().encode('{ not valid json')))
      const parseError = decodeJson(
        channel.decrypt((await conn.nextData()).payload) ?? new Uint8Array()
      ) as {
        error: { code: number }
        id: string | null
      }
      expect(parseError).toMatchObject({ error: { code: -32700 }, id: null })

      // ② method 非 string —— 旧代码 throw 'Invalid JSON-RPC method' → 崩溃。
      sendData(conn, channel.encrypt(encodeJson({ id: 'rpc-bad', method: 123, params: {} })))
      const invalidRequest = decodeJson(
        channel.decrypt((await conn.nextData()).payload) ?? new Uint8Array()
      ) as { error: { code: number }; id: string }
      expect(invalidRequest).toMatchObject({ error: { code: -32600 }, id: 'rpc-bad' })

      // ③ 畸形输入处理完后，正常 RPC 仍可用（证明会话未被破坏）。
      sendData(
        conn,
        channel.encrypt(encodeJson({ id: 'rpc-ok', method: 'runtime.status', params: {} }))
      )
      const okResponse = decodeJson(
        channel.decrypt((await conn.nextData()).payload) ?? new Uint8Array()
      ) as {
        id: string
        result: unknown
      }
      expect(okResponse).toMatchObject({ id: 'rpc-ok', result: { ok: true } })

      // 让微任务/事件循环跑一轮，确认没有任何 unhandled rejection 冒泡。
      await delay(30)
      expect(rejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onRejection)
    }
  })

  it('③c: in-flight async response is dropped after reconnect instead of using a stale channel', async () => {
    const relay = await startFakeRelay()
    relays.push(relay)

    const slowInvoked = deferred<void>()
    const release = deferred<void>()
    const connector = createRelayConnector(
      configForPort(relay.port),
      async (method) => {
        if (method === 'slow') {
          slowInvoked.resolve()
          await release.promise
          return { ok: true }
        }
        return { ok: true }
      },
      {
        authenticateDevice: () => ({ capabilities: ['read_dashboard'], id: 'device-1' }),
        heartbeatIntervalMs: 10_000,
        reconnectBaseDelayMs: 10,
        reconnectMaxDelayMs: 20,
      }
    )
    connectors.push(connector)

    // 第一条连接 + 握手 + 发起一个会卡住的 RPC。
    const first = await relay.waitForConnection(0)
    const channel = await handshakeAsDevice(first)
    sendData(first, channel.encrypt(encodeJson({ id: 'rpc-slow', method: 'slow', params: {} })))
    await slowInvoked.promise

    // 强制断开第一条连接 → connector 触发 sessions.clear() + 重连。
    relay.closeConnection(0)

    // 第二条连接建立（新 socket，尚未握手，sessions 为空）。
    const second = await relay.waitForConnection(1)
    await delay(20) // 等 connector 完成 open/join，socket 指向 second。

    // 现在释放卡住的 handler：在途响应若用旧 channel 加密会被发到 second（旧代码行为）。
    release.resolve()
    await delay(60)

    // 修复后：因发起请求的会话已不在 sessions 中，响应被丢弃，second 收不到任何 data 帧。
    expect(second.dataCount()).toBe(0)
  })
})
