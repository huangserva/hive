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

  test('pairs and calls mobile API routes with bearer auth', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ host: '127.0.0.1', port: 4010, token: 'mobile-token' }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ version: '1.4.0', cwd: '/repo' }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve([{ id: 'workspace-1', name: 'HippoTeam', path: '/repo' }]),
        ok: true,
      })
    const client = createRuntimeClient({ fetchImpl, host: '10.0.0.2:4010', token: 'mobile-token' })

    await expect(client.pairMobile()).resolves.toEqual({
      host: '127.0.0.1',
      port: 4010,
      token: 'mobile-token',
    })
    await expect(client.getMobileRuntimeStatus()).resolves.toEqual({
      cwd: '/repo',
      version: '1.4.0',
    })
    await expect(client.listMobileWorkspaces()).resolves.toEqual([
      { id: 'workspace-1', name: 'HippoTeam', path: '/repo' },
    ])

    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'http://10.0.0.2:4010/api/mobile/pair', {
      headers: { Accept: 'application/json' },
    })
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'http://10.0.0.2:4010/api/mobile/runtime/status', {
      headers: { Accept: 'application/json', Authorization: 'Bearer mobile-token' },
    })
    expect(fetchImpl).toHaveBeenNthCalledWith(3, 'http://10.0.0.2:4010/api/mobile/workspaces', {
      headers: { Accept: 'application/json', Authorization: 'Bearer mobile-token' },
    })
  })

  test('fetches dashboard data and builds authenticated dashboard websocket URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          cockpit: {
            ai_actions_count: 1,
            baseline_stale: true,
            high_ai_actions: 0,
            open_questions: 2,
          },
          generated_at: '2026-05-25T00:00:00.000Z',
          plan: { active_milestone: 'M19a', current_phase: 'mobile' },
          runs: [],
          tasks: { total_done: 7, total_open: 3 },
          workers: [],
          workspace: { id: 'workspace-1', name: 'HippoTeam', path: '/repo' },
        }),
      ok: true,
    })
    const client = createRuntimeClient({ fetchImpl, host: '10.0.0.2:4010', token: 'mobile-token' })

    await expect(client.getMobileDashboard('workspace-1')).resolves.toMatchObject({
      plan: { active_milestone: 'M19a', current_phase: 'mobile' },
      tasks: { total_done: 7, total_open: 3 },
    })
    expect(client.buildMobileDashboardWebSocketUrl('workspace-1')).toBe(
      'ws://10.0.0.2:4010/ws/mobile/workspaces/workspace-1/dashboard?token=mobile-token'
    )

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://10.0.0.2:4010/api/mobile/workspaces/workspace-1/dashboard',
      { headers: { Accept: 'application/json', Authorization: 'Bearer mobile-token' } }
    )
  })

  test('builds websocket URLs against the configured host', () => {
    const client = createRuntimeClient({ host: 'http://10.0.0.2:4010/' })

    expect(client.buildWebSocketUrl('/ws/cockpit/ws-1')).toBe('ws://10.0.0.2:4010/ws/cockpit/ws-1')
  })
})
