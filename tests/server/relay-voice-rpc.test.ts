import { describe, expect, test, vi } from 'vitest'

import { createRelayRpcHandler } from '../../src/server/relay-rpc-handler.js'
import { createRuntimeStore } from '../../src/server/runtime-store.js'

const createMockStore = () => {
  const store = createRuntimeStore()
  return {
    approvalLedger: store.approvalLedger,
    dispatchTask: store.dispatchTask,
    getActiveRunByAgentId: store.getActiveRunByAgentId,
    getPtySnapshotForAgent: store.getPtySnapshotForAgent,
    getWorker: store.getWorker,
    listDispatches: store.listDispatches,
    listWorkspaces: store.listWorkspaces,
    requireMobileCapability: vi.fn(),
    startAgent: store.startAgent,
    stopAgentRun: store.stopAgentRun,
    updateMobilePushToken: vi.fn(),
  }
}

describe('relay RPC voice.transcribe', () => {
  test('returns stt_unavailable when whisper is not installed', async () => {
    const store = createMockStore()
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir: '/tmp', port: 0 },
      store,
    })
    const result = (await handler('voice.transcribe', { audio: 'fakebase64data' }, 'device-1', [
      'send_prompt',
    ])) as { error?: string }
    expect(store.requireMobileCapability).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'device-1', capabilities: ['send_prompt'] }),
      'send_prompt'
    )
    expect(result.error).toBe('stt_unavailable')
  })

  test('rejects without send_prompt capability', async () => {
    const store = createMockStore()
    store.requireMobileCapability.mockImplementation(() => {
      throw new Error('Missing capability: send_prompt')
    })
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir: '/tmp', port: 0 },
      store,
    })
    await expect(
      handler('voice.transcribe', { audio: 'fake' }, 'device-1', ['read_dashboard'])
    ).rejects.toThrow(/send_prompt/)
  })

  test('rejects without audio param', async () => {
    const store = createMockStore()
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir: '/tmp', port: 0 },
      store,
    })
    await expect(handler('voice.transcribe', {}, 'device-1', ['send_prompt'])).rejects.toThrow(
      /audio is required/
    )
  })

  test('rejects unknown method', async () => {
    const store = createMockStore()
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir: '/tmp', port: 0 },
      store,
    })
    await expect(handler('voice.nonexistent', {}, 'device-1', ['send_prompt'])).rejects.toThrow(
      /Unknown relay RPC method/
    )
  })
})
