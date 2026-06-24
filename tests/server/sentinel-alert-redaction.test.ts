import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

import { createAgentManager } from '../../src/server/agent-manager.js'
import { createRelayRpcHandler } from '../../src/server/relay-rpc-handler.js'
import { createRuntimeStoreServices } from '../../src/server/runtime-store-helpers.js'
import { buildSentinelAlertActions } from '../../src/server/sentinel-alert-status.js'

const tempDirs: string[] = []

afterEach(() => {
  vi.unstubAllGlobals()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const makeTempDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

const waitForPush = async (fetchSpy: ReturnType<typeof vi.fn>) => {
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    if (fetchSpy.mock.calls.length > 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect(fetchSpy).toHaveBeenCalled()
}

describe('sentinel alert redaction', () => {
  test('redacts spawn failure secrets before cockpit actions mobile push and relay surfaces read alerts', async () => {
    const secret = 'glm-visible-secret'
    const dataDir = makeTempDir('hive-sentinel-redaction-data-')
    const workspacePath = makeTempDir('hive-sentinel-redaction-ws-')
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    const services = createRuntimeStoreServices({
      agentManager: createAgentManager(),
      dataDir,
    })
    try {
      const workspace = services.workspaceStore.createWorkspace(workspacePath, 'Redaction')
      const worker = services.workspaceStore.addWorker(workspace.id, {
        name: 'Coder',
        role: 'coder',
      })
      const { device } = services.mobileAuthStore.createDeviceToken('Phone', ['read_dashboard'])
      services.mobileAuthStore.updatePushToken(device.id, 'ExponentPushToken[test]')
      services.secretStore.set('GLM_API_KEY', secret)

      for (let index = 0; index < 2; index += 1) {
        services.mobileChatStore.insertChatMessage(
          workspace.id,
          'outbound',
          'system_event',
          JSON.stringify({
            command: `codex-${secret}`,
            error: `spawn failed ${secret}`,
            event: 'dispatch_spawn_failed',
            path: `/usr/bin:${secret}`,
            worker: 'Coder',
            worker_id: worker.id,
          })
        )
      }

      await services.sentinelHeartbeat?.tick()
      await waitForPush(fetchSpy)

      const activeAlerts = services.sentinelAlertStore.listWorkspaceAlerts(workspace.id)
      const activeAlertText = JSON.stringify(activeAlerts)
      expect(activeAlertText).toContain('[REDACTED]')
      expect(activeAlertText).not.toContain(secret)

      const aiActions = buildSentinelAlertActions(activeAlerts)
      const aiActionText = JSON.stringify(aiActions)
      expect(aiActionText).toContain('[REDACTED]')
      expect(aiActionText).not.toContain(secret)

      const pushText = JSON.stringify(fetchSpy.mock.calls.map((call) => (call as unknown[])[1]))
      expect(pushText).toContain('[REDACTED]')
      expect(pushText).not.toContain(secret)

      const relayHandler = createRelayRpcHandler({
        runtimeInfo: { dataDir, port: 4010 },
        store: {
          getWorkspaceSnapshot: (workspaceId: string) =>
            services.workspaceStore.getWorkspaceSnapshot(workspaceId),
          listActiveSentinelAlerts: (workspaceId: string) =>
            services.sentinelAlertStore.listWorkspaceAlerts(workspaceId),
          listDispatches: services.dispatchLedgerStore.listWorkspaceDispatches,
          listWorkers: (workspaceId: string) => services.workspaceStore.listWorkers(workspaceId),
          peekAgentLaunchConfig: () => undefined,
          requireMobileCapability: services.mobileAuthStore.requireCapability,
        } as never,
      })
      const relayCockpit = await relayHandler(
        'workspace.cockpit',
        { workspace_id: workspace.id },
        device.id,
        ['read_dashboard']
      )
      const relayText = JSON.stringify(relayCockpit)
      expect(relayText).toContain('[REDACTED]')
      expect(relayText).not.toContain(secret)
    } finally {
      services.db.close()
      await services.tasksFileWatcher.close()
    }
  })
})
