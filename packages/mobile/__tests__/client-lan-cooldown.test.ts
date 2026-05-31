import { describe, expect, test, vi } from 'vitest'

import { createRuntimeClient } from '../src/api/client.js'
import type { RelayTransport } from '../src/api/relay-transport.js'

// 可控假 relayTransport：永远 ready + call 立刻成功。
const makeRelay = (): { transport: RelayTransport; calls: string[] } => {
  const calls: string[] = []
  const transport: RelayTransport = {
    async call<T>(method: string): Promise<T> {
      calls.push(method)
      return { ok: true, via: 'relay' } as T
    },
    close() {},
    async connect() {},
    onEvent() {
      return () => {}
    },
    onStatusChange() {
      return () => {}
    },
    status() {
      return 'ready'
    },
  }
  return { calls, transport }
}

const jsonResponse = (body: unknown): Response =>
  ({ json: async () => body, ok: true, status: 200 }) as unknown as Response

describe('LAN 可达性冷却（跳过 LAN 空试）', () => {
  test('LAN 失败后，冷却窗口内的请求直接走 relay、不再发 LAN fetch', async () => {
    const { calls, transport } = makeRelay()
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const client = createRuntimeClient({
      fetchImpl,
      lanCooldownMs: 30_000,
      relayTransport: transport,
      token: 'tok',
    })

    // 第 1 次：试 LAN（fetch 调一次）失败 → 回落 relay + 开冷却。
    await expect(client.getMobileRuntimeStatus()).resolves.toEqual({ ok: true, via: 'relay' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    // 第 2、3 次：冷却窗口内，直接 relay，绝不再发 LAN fetch。
    await client.listMobileWorkspaces()
    await client.getMobileRuntimeStatus()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['runtime.status', 'workspaces.list', 'runtime.status'])
    expect(client.connectionMode()).toBe('relay')
  })

  test('冷却到期后重探 LAN：LAN 恢复则解除冷却、回到 LAN 优先', async () => {
    const { transport } = makeRelay()
    let lanUp = false
    const fetchImpl = vi.fn(async () => {
      if (!lanUp) throw new Error('network down')
      return jsonResponse({ ok: true, via: 'lan' })
    }) as unknown as typeof fetch
    const client = createRuntimeClient({
      fetchImpl,
      lanCooldownMs: 50,
      relayTransport: transport,
      token: 'tok',
    })

    await client.getMobileRuntimeStatus() // LAN 失败 → relay + 冷却 50ms
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await client.getMobileRuntimeStatus() // 冷却内 → relay，未再探 LAN
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    // 回到 WiFi，冷却到期。
    lanUp = true
    await new Promise((resolve) => setTimeout(resolve, 60))
    const result = await client.getMobileRuntimeStatus() // 冷却到期 → 重探 LAN，成功
    expect(result).toEqual({ ok: true, via: 'lan' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(client.connectionMode()).toBe('lan')

    // 冷却已解除 → 后续仍 LAN 优先。
    await client.getMobileRuntimeStatus()
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  test('LAN 一直健康：从不开冷却、始终 LAN、relay 不被调用', async () => {
    const { calls, transport } = makeRelay()
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true, via: 'lan' })
    ) as unknown as typeof fetch
    const client = createRuntimeClient({ fetchImpl, relayTransport: transport, token: 'tok' })

    await client.getMobileRuntimeStatus()
    await client.listMobileWorkspaces()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(calls).toEqual([])
    expect(client.connectionMode()).toBe('lan')
  })

  test('resetLanCooldown() 强制下次立即重探 LAN', async () => {
    const { transport } = makeRelay()
    let lanUp = false
    const fetchImpl = vi.fn(async () => {
      if (!lanUp) throw new Error('network down')
      return jsonResponse({ ok: true, via: 'lan' })
    }) as unknown as typeof fetch
    const client = createRuntimeClient({
      fetchImpl,
      lanCooldownMs: 30_000,
      relayTransport: transport,
      token: 'tok',
    })

    await client.getMobileRuntimeStatus() // LAN 失败 → 冷却 30s
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await client.getMobileRuntimeStatus() // 冷却内 → relay
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    // 网络变化回调强制重探，不必等 30s。
    lanUp = true
    client.resetLanCooldown()
    const result = await client.getMobileRuntimeStatus()
    expect(result).toEqual({ ok: true, via: 'lan' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(client.connectionMode()).toBe('lan')
  })

  test('preferRelayUntilReset() 让下一次请求优先走 relay，直到手动重置', async () => {
    const { calls, transport } = makeRelay()
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ok: true, via: 'lan' })
    ) as unknown as typeof fetch
    const client = createRuntimeClient({
      fetchImpl,
      relayTransport: transport,
      token: 'tok',
    })

    client.preferRelayUntilReset()
    const result = await client.getMobileRuntimeStatus()

    expect(result).toEqual({ ok: true, via: 'relay' })
    expect(fetchImpl).toHaveBeenCalledTimes(0)
    expect(calls).toEqual(['runtime.status'])
    expect(client.connectionMode()).toBe('relay')
  })
})
