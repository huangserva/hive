import { describe, expect, it } from 'vitest'

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
})
