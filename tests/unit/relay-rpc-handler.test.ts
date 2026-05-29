import { describe, expect, it, vi } from 'vitest'

import { createRelayRpcHandler } from '../../src/server/relay-rpc-handler.js'

describe('relay RPC handler', () => {
  it('requires read_dashboard for dashboard reads', async () => {
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store: {
        listWorkspaces: () => [{ id: 'ws-1', name: 'Demo', path: '/tmp/demo' }],
        requireMobileCapability: (_device: unknown, capability: string) => {
          if (capability !== 'read_dashboard') throw new Error(`wrong capability ${capability}`)
        },
      },
    })

    await expect(handler('workspaces.list', {}, 'device-1', ['read_dashboard'])).resolves.toEqual([
      { id: 'ws-1', name: 'Demo', path: '/tmp/demo' },
    ])
  })

  it('rejects dispatch RPC without send_prompt capability', async () => {
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store: {
        requireMobileCapability: () => {
          throw new Error('Missing mobile capability: send_prompt')
        },
      },
    })

    await expect(
      handler(
        'workspace.dispatch',
        { task: 'hello', worker_id: 'worker-1', workspace_id: 'ws-1' },
        'device-1',
        ['read_dashboard']
      )
    ).rejects.toThrow('Missing mobile capability: send_prompt')
  })

  it('serves worker transcript RPC with read_terminal capability', async () => {
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store: {
        getAgent: () => ({ id: 'worker-1', name: 'Alice', status: 'working' }),
        getPtySnapshotForAgent: async () => '\u001b[32mfirst\u001b[0m\nsecond\n',
        getWorker: () => ({ id: 'worker-1', name: 'Alice', status: 'working' }),
        requireMobileCapability: (_device: unknown, capability: string) => {
          if (capability !== 'read_terminal') throw new Error(`wrong capability ${capability}`)
        },
      },
    })

    await expect(
      handler('worker.transcript', { worker_id: 'worker-1', workspace_id: 'ws-1' }, 'device-1', [
        'read_terminal',
      ])
    ).resolves.toEqual({
      lines: ['first', 'second'],
      status: 'working',
      truncated: false,
      worker_id: 'worker-1',
      worker_name: 'Alice',
    })
  })

  it('serves workspace task RPC with read_dashboard capability', async () => {
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store: {
        getWorker: () => ({ id: 'worker-1', name: 'Alice', status: 'stopped' }),
        listDispatches: () => [
          {
            artifacts: [],
            createdAt: Date.parse('2026-05-26T00:00:00.000Z'),
            deliveredAt: null,
            fromAgentId: null,
            id: 'dispatch-1',
            reportedAt: null,
            reportText: null,
            sequence: 1,
            status: 'submitted',
            submittedAt: Date.parse('2026-05-26T00:00:01.000Z'),
            text: 'Run the mobile task endpoint smoke test',
            toAgentId: 'worker-1',
            workspaceId: 'ws-1',
          },
        ],
        requireMobileCapability: (_device: unknown, capability: string) => {
          if (capability !== 'read_dashboard') throw new Error(`wrong capability ${capability}`)
        },
      },
    })

    await expect(
      handler('workspace.tasks', { workspace_id: 'ws-1' }, 'device-1', ['read_dashboard'])
    ).resolves.toEqual({
      dispatches: [
        {
          created_at: '2026-05-26T00:00:00.000Z',
          id: 'dispatch-1',
          status: 'pending',
          task_summary: 'Run the mobile task endpoint smoke test',
          worker_name: 'Alice',
        },
      ],
      workspace_id: 'ws-1',
    })
  })

  it('registers push tokens over relay RPC for the authenticated device', async () => {
    const updateMobilePushToken = vi.fn()
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir: '/tmp/hive', port: 4010 },
      store: {
        requireMobileCapability: (_device: unknown, capability: string) => {
          if (capability !== 'read_dashboard') throw new Error(`wrong capability ${capability}`)
        },
        updateMobilePushToken,
      },
    })

    await expect(
      handler(
        'device.register_push_token',
        { push_token: 'ExponentPushToken[relay]' },
        'device-1',
        ['read_dashboard']
      )
    ).resolves.toEqual({ ok: true })
    expect(updateMobilePushToken).toHaveBeenCalledWith('device-1', 'ExponentPushToken[relay]')
  })
})
