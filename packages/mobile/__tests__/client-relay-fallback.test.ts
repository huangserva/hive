import { describe, expect, test, vi } from 'vitest'

import { createRuntimeClient } from '../src/api/client.js'
import type { RelayTransport, RelayTransportStatus } from '../src/api/relay-transport.js'

// 一个可控的假 relayTransport：默认 ready + call 立刻成功；可注入 status / connect 行为。
const makeRelay = (
  overrides: Partial<{
    connect: () => Promise<void>
    initialStatus: RelayTransportStatus
    statusAfterConnect: RelayTransportStatus
  }> = {}
): { transport: RelayTransport; calls: string[]; connectCount: () => number } => {
  let status: RelayTransportStatus = overrides.initialStatus ?? 'ready'
  let connectCount = 0
  const calls: string[] = []
  const transport: RelayTransport = {
    async call<T>(method: string): Promise<T> {
      calls.push(method)
      return { ok: true, via: 'relay' } as T
    },
    close() {},
    async connect() {
      connectCount += 1
      if (overrides.connect) {
        await overrides.connect()
      }
      status = overrides.statusAfterConnect ?? 'ready'
    },
    async measureVoiceStreamLatency() {
      return { count: 0, lost: 0, max_ms: 0, p50_ms: 0, p95_ms: 0, received: 0, stream_id: 'test' }
    },
    onEvent() {
      return () => {}
    },
    onStatusChange() {
      return () => {}
    },
    onVoiceCallStateFrame() {
      return () => {}
    },
    onVoiceDownlinkSegmentFrame() {
      return () => {}
    },
    onWebRtcSignalFrame() {
      return () => {}
    },
    onVoiceStreamFrame() {
      return () => {}
    },
    async requestVoiceStreamSynthesis() {
      return { audio: '', format: 'm4a', mime: 'audio/mp4', stream_id: 'test' }
    },
    sendWebRtcSignalFrame() {},
    sendVoiceStreamFrame() {},
    status() {
      return status
    },
  }
  return { calls, connectCount: () => connectCount, transport }
}

// 一个永不 resolve、但尊重 AbortSignal 的 fetch（模拟连不通的 LAN 在 4G 下 hang）。
const hangingFetch = (): typeof fetch =>
  ((_url: string, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal
      if (signal) {
        signal.addEventListener('abort', () => reject(new Error('The operation was aborted')))
      }
    })) as unknown as typeof fetch

const jsonResponse = (body: unknown): Response =>
  ({ json: async () => body, ok: true, status: 200 }) as unknown as Response

describe('LAN → relay 回落（client.ts）', () => {
  test('LAN fetch hang → 超时内 abort 并回落到 relayCall', async () => {
    const { calls, transport } = makeRelay()
    const client = createRuntimeClient({
      fetchImpl: hangingFetch(),
      host: '192.168.110.2:4010',
      lanTimeoutMs: 50,
      relayTransport: transport,
      token: 'tok',
    })

    const result = await client.getMobileRuntimeStatus()

    expect(result).toEqual({ ok: true, via: 'relay' })
    expect(calls).toEqual(['runtime.status'])
    expect(client.connectionMode()).toBe('relay')
  })

  test('LAN 快速失败 → 立刻回落 relay（不等满超时）', async () => {
    const { calls, transport } = makeRelay()
    const fetchImpl = vi.fn(async () => {
      throw new Error('Network request failed')
    }) as unknown as typeof fetch
    const client = createRuntimeClient({
      fetchImpl,
      lanTimeoutMs: 4000,
      relayTransport: transport,
      token: 'tok',
    })

    const result = await client.getMobileRuntimeStatus()

    expect(result).toEqual({ ok: true, via: 'relay' })
    expect(calls).toEqual(['runtime.status'])
    expect(client.connectionMode()).toBe('relay')
  })

  test('LAN 成功 → 用 LAN，mode=lan，不碰 relay', async () => {
    const { calls, transport } = makeRelay()
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true, via: 'lan' })
    ) as unknown as typeof fetch
    const client = createRuntimeClient({
      fetchImpl,
      relayTransport: transport,
      token: 'tok',
    })

    const result = await client.getMobileRuntimeStatus()

    expect(result).toEqual({ ok: true, via: 'lan' })
    expect(calls).toEqual([])
    expect(client.connectionMode()).toBe('lan')
  })

  test('健康检查 LAN 不可达 → 最终 connectionMode=relay，不 hang（含 connect 等待）', async () => {
    // relay 起初 disconnected，需要先 connect 才 ready：验证 relayCall 会 await connect 且不挂死。
    const { calls, connectCount, transport } = makeRelay({
      initialStatus: 'disconnected',
      statusAfterConnect: 'ready',
    })
    const client = createRuntimeClient({
      fetchImpl: hangingFetch(),
      host: '10.0.0.9:4010',
      lanTimeoutMs: 50,
      relayTransport: transport,
      token: 'tok',
    })

    const result = await client.getMobileRuntimeStatus()

    expect(result).toEqual({ ok: true, via: 'relay' })
    expect(connectCount()).toBe(1)
    expect(calls).toEqual(['runtime.status'])
    expect(client.connectionMode()).toBe('relay')
  })

  test('relay connect 永不返回 → 超时抛错，不静默挂死', async () => {
    const { transport } = makeRelay({
      connect: () => new Promise<void>(() => {}), // 永不 resolve
      initialStatus: 'disconnected',
    })
    const client = createRuntimeClient({
      fetchImpl: hangingFetch(),
      lanTimeoutMs: 50,
      relayConnectTimeoutMs: 60,
      relayTransport: transport,
      token: 'tok',
    })

    await expect(client.getMobileRuntimeStatus()).rejects.toThrow(/Relay connect timed out/)
  })
})
