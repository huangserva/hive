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

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://10.0.0.2:4010/api/runtime/status',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
      })
    )
  })

  test('calls mobile API routes with bearer auth', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ version: '1.4.0', cwd: '/repo' }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve([{ id: 'workspace-1', name: 'HippoTeam', path: '/repo' }]),
        ok: true,
      })
    const client = createRuntimeClient({ fetchImpl, host: '10.0.0.2:4010', token: 'mobile-token' })

    await expect(client.getMobileRuntimeStatus()).resolves.toEqual({
      cwd: '/repo',
      version: '1.4.0',
    })
    await expect(client.listMobileWorkspaces()).resolves.toEqual([
      { id: 'workspace-1', name: 'HippoTeam', path: '/repo' },
    ])

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'http://10.0.0.2:4010/api/mobile/runtime/status',
      expect.objectContaining({
        headers: { Accept: 'application/json', Authorization: 'Bearer mobile-token' },
      })
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'http://10.0.0.2:4010/api/mobile/workspaces',
      expect.objectContaining({
        headers: { Accept: 'application/json', Authorization: 'Bearer mobile-token' },
      })
    )
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
      expect.objectContaining({
        headers: { Accept: 'application/json', Authorization: 'Bearer mobile-token' },
      })
    )
  })

  test('builds websocket URLs against the configured host', () => {
    const client = createRuntimeClient({ host: 'http://10.0.0.2:4010/' })

    expect(client.buildWebSocketUrl('/ws/cockpit/ws-1')).toBe('ws://10.0.0.2:4010/ws/cockpit/ws-1')
  })

  test('sends worker control actions with bearer auth', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true, status: 'stopped' }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true, run_id: 'run-1' }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ dispatch_id: 'dispatch-1', ok: true }),
        ok: true,
      })
    const client = createRuntimeClient({ fetchImpl, host: '10.0.0.2:4010', token: 'mobile-token' })

    await expect(client.stopWorker('workspace-1', 'worker-1')).resolves.toEqual(undefined)
    await expect(client.restartWorker('workspace-1', 'worker-1')).resolves.toEqual(undefined)
    await expect(
      client.dispatchTask('workspace-1', 'worker-1', 'Run mobile smoke test')
    ).resolves.toMatchObject({ dispatch_id: 'dispatch-1' })

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'http://10.0.0.2:4010/api/mobile/workspaces/workspace-1/workers/worker-1/stop',
      expect.objectContaining({
        headers: { Accept: 'application/json', Authorization: 'Bearer mobile-token' },
        method: 'POST',
      })
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'http://10.0.0.2:4010/api/mobile/workspaces/workspace-1/workers/worker-1/restart',
      expect.objectContaining({
        headers: { Accept: 'application/json', Authorization: 'Bearer mobile-token' },
        method: 'POST',
      })
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      'http://10.0.0.2:4010/api/mobile/workspaces/workspace-1/dispatch',
      expect.objectContaining({
        body: JSON.stringify({ task: 'Run mobile smoke test', worker_id: 'worker-1' }),
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer mobile-token',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      })
    )
  })

  test('fetches worker transcript and workspace task history over LAN', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            lines: ['one', 'two'],
            status: 'working',
            truncated: false,
            worker_id: 'worker-1',
            worker_name: 'Alice',
          }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            dispatches: [
              {
                created_at: '2026-05-26T00:00:00.000Z',
                id: 'dispatch-1',
                status: 'pending',
                task_summary: 'Run smoke',
                worker_name: 'Alice',
              },
            ],
            workspace_id: 'workspace-1',
          }),
        ok: true,
      })
    const client = createRuntimeClient({ fetchImpl, host: '10.0.0.2:4010', token: 'mobile-token' })

    await expect(client.getWorkerTranscript('workspace-1', 'worker-1')).resolves.toMatchObject({
      lines: ['one', 'two'],
      worker_name: 'Alice',
    })
    await expect(client.getWorkspaceTasks('workspace-1')).resolves.toMatchObject({
      dispatches: [{ id: 'dispatch-1', status: 'pending' }],
    })

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'http://10.0.0.2:4010/api/mobile/workspaces/workspace-1/workers/worker-1/transcript',
      expect.objectContaining({
        headers: { Accept: 'application/json', Authorization: 'Bearer mobile-token' },
      })
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'http://10.0.0.2:4010/api/mobile/workspaces/workspace-1/tasks',
      expect.objectContaining({
        headers: { Accept: 'application/json', Authorization: 'Bearer mobile-token' },
      })
    )
  })

  test('falls back to relay RPC for transcript and task history when LAN is unavailable', async () => {
    const relayCalls: Array<{ method: string; params: unknown }> = []
    const relayTransport = {
      call: async <T>(method: string, params: unknown) => {
        relayCalls.push({ method, params })
        return (
          method === 'worker.transcript'
            ? { lines: ['relay'], status: 'idle', truncated: false, worker_id: 'worker-1' }
            : { dispatches: [], workspace_id: 'workspace-1' }
        ) as T
      },
      connect: async () => {},
      status: () => 'ready' as const,
    }
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 })
    const client = createRuntimeClient({
      fetchImpl,
      host: '10.0.0.2:4010',
      relayTransport,
      token: 'mobile-token',
    })

    await expect(client.getWorkerTranscript('workspace-1', 'worker-1')).resolves.toMatchObject({
      lines: ['relay'],
    })
    await expect(client.getWorkspaceTasks('workspace-1')).resolves.toMatchObject({
      dispatches: [],
    })

    expect(relayCalls).toEqual([
      {
        method: 'worker.transcript',
        params: { worker_id: 'worker-1', workspace_id: 'workspace-1' },
      },
      { method: 'workspace.tasks', params: { workspace_id: 'workspace-1' } },
    ])
    expect(client.connectionMode()).toBe('relay')
  })
})
