import { describe, expect, test, vi } from 'vitest'

import { createRuntimeClient, normalizeRuntimeHost } from '../../packages/mobile/src/api/client.js'

describe('mobile runtime client', () => {
  test('normalizes LAN host input into an http base URL', () => {
    expect(normalizeRuntimeHost('192.168.1.20:4010')).toBe('http://192.168.1.20:4010')
    expect(normalizeRuntimeHost(' http://10.0.0.2:4010/ ')).toBe('http://10.0.0.2:4010')
  })

  test('fetches runtime status from the configured host', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ cwd: '/workspace', version: '1.0.0' }),
      ok: true,
    })
    const client = createRuntimeClient({ fetchImpl, host: '10.0.0.2:4010' })

    await expect(client.getRuntimeStatus()).resolves.toEqual({
      cwd: '/workspace',
      version: '1.0.0',
    })

    expect(fetchImpl).toHaveBeenCalledWith('http://10.0.0.2:4010/api/runtime/status', {
      headers: { Accept: 'application/json' },
    })
  })

  test('builds websocket URLs against the configured host', () => {
    const client = createRuntimeClient({ host: 'http://10.0.0.2:4010/' })

    expect(client.buildWebSocketUrl('/ws/cockpit/ws-1')).toBe('ws://10.0.0.2:4010/ws/cockpit/ws-1')
  })
})
