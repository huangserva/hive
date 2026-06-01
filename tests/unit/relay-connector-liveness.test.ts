import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { generateKeyPair } from '../../packages/relay-crypto/src/index.js'
import { createRelayConnector, type RelayConfig } from '../../src/server/relay-connector.js'

// P0+ 根因修复 ① 复现测试：daemon 的 relay socket 半开（对端不再回任何帧、readyState 仍 OPEN）。
// 旧实现永远当自己活着 → 成 relay room 僵尸 → 手机消息被转发给死连接静默丢弃、重登也救不回。
// 这里用 fake socket + fake timers 复现"发心跳但对端不回 ack"→ 断言 daemon 判死 + 重连（非无限僵尸）。
// §13：测真实失败模式（连接探活），不是纯函数。

type Handler = (arg?: unknown) => void

class FakeWs {
  static instances: FakeWs[] = []
  readyState = 0
  terminated = false
  sent: Array<Record<string, unknown>> = []
  private handlers: Record<string, Handler[]> = {}

  constructor(readonly url: string) {
    FakeWs.instances.push(this)
    // ws 在连接建立后异步触发 'open'；fake 用 timer 模拟，连接器在 'open' 里发 join。
    setTimeout(() => {
      this.readyState = 1
      this.fire('open')
    }, 0)
  }

  on(event: string, cb: Handler) {
    const list = this.handlers[event] ?? []
    list.push(cb)
    this.handlers[event] = list
  }

  private fire(event: string, arg?: unknown) {
    for (const cb of this.handlers[event] ?? []) cb(arg)
  }

  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
  }

  // 测试驱动：模拟从 relay 收到一帧。
  emit(frame: unknown) {
    this.fire('message', Buffer.from(JSON.stringify(frame)))
  }

  terminate() {
    this.terminated = true
    this.readyState = 3
    this.fire('close')
  }

  close() {
    this.readyState = 3
    this.fire('close')
  }
}

const buildConfig = (): RelayConfig => ({
  daemon_keypair: generateKeyPair(),
  enabled: true,
  relay_auth_token: 'relay-secret',
  relay_url: 'ws://relay.test/v1',
  room_id: 'room-1',
  runtime_id: 'runtime-1',
})

beforeEach(() => {
  vi.useFakeTimers()
  FakeWs.instances = []
})
afterEach(() => {
  vi.useRealTimers()
})

describe('relay connector heartbeat-ack liveness (root-cause fix ①)', () => {
  test('half-open socket (no inbound frames) is judged dead → terminate + reconnect (not a zombie)', async () => {
    const conn = createRelayConnector(buildConfig(), async () => ({}), {
      WebSocketCtor: FakeWs as unknown as new (url: string) => WebSocket,
      heartbeatIntervalMs: 1000,
      livenessTimeoutMs: 2500,
      reconnectBaseDelayMs: 10,
      reconnectMaxDelayMs: 10,
    })
    await vi.advanceTimersByTimeAsync(0) // 触发 'open'
    const first = FakeWs.instances[0]
    expect(first).toBeDefined()
    expect(first?.sent.some((f) => f.type === 'join')).toBe(true)

    // 进入 connected：收到 joined（这是最后一次入站帧）。
    first?.emit({ type: 'joined' })

    // 之后对端再不回任何帧（半开 socket）。推进超过 livenessTimeoutMs。
    await vi.advanceTimersByTimeAsync(3000)
    expect(first?.terminated).toBe(true) // 被判死并强制 terminate

    // terminate → onclose → scheduleReconnect(10ms) → 建新 socket（重 join 顶掉僵尸）。
    await vi.advanceTimersByTimeAsync(30)
    expect(FakeWs.instances.length).toBeGreaterThanOrEqual(2)

    conn.close()
  })

  test('a connection that keeps receiving frames within the window is NOT judged dead', async () => {
    const conn = createRelayConnector(buildConfig(), async () => ({}), {
      WebSocketCtor: FakeWs as unknown as new (url: string) => WebSocket,
      heartbeatIntervalMs: 1000,
      livenessTimeoutMs: 2500,
      reconnectBaseDelayMs: 10,
      reconnectMaxDelayMs: 10,
    })
    await vi.advanceTimersByTimeAsync(0)
    const first = FakeWs.instances[0]
    first?.emit({ type: 'joined' })

    // 每 1000ms 回一次 heartbeat_ack（< 2500ms 阈值）→ 始终活着。
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(1000)
      first?.emit({ type: 'heartbeat_ack' })
    }

    expect(first?.terminated).toBe(false)
    expect(FakeWs.instances.length).toBe(1) // 没重连

    conn.close()
  })
})
