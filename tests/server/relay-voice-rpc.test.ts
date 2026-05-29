import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

import { createAgentManager } from '../../src/server/agent-manager.js'
import { createRelayRpcHandler } from '../../src/server/relay-rpc-handler.js'
import { createRuntimeStore } from '../../src/server/runtime-store.js'

const tempDirs: string[] = []
const originalPath = process.env.PATH
const stores: Array<ReturnType<typeof createRuntimeStore>> = []

const waitFor = async (assertion: () => void, timeoutMs = 2000, intervalMs = 25) => {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() <= deadline) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }

  throw lastError
}

afterEach(async () => {
  process.env.PATH = originalPath
  await Promise.all(stores.splice(0).map((store) => store.close()))
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

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
    recordUserInput: store.recordUserInput,
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

  test('rejects path-traversal audio format before writing outside the temp directory', async () => {
    const binDir = mkdtempSync(join(tmpdir(), 'hive-relay-stt-bin-'))
    tempDirs.push(binDir)
    const whisper = join(binDir, 'whisper')
    writeFileSync(whisper, '#!/usr/bin/env node\nconsole.log("transcript")\n', 'utf8')
    chmodSync(whisper, 0o755)
    process.env.PATH = binDir
    const outsidePath = join(tmpdir(), `hive-voice-escape-${Date.now()}`)
    rmSync(outsidePath, { force: true })

    const store = createMockStore()
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir: '/tmp', port: 0 },
      store,
    })

    await expect(
      handler(
        'voice.transcribe',
        {
          audio: Buffer.from('audio bytes').toString('base64'),
          format: `../../../${basename(outsidePath)}`,
        },
        'device-1',
        ['send_prompt']
      )
    ).rejects.toThrow(/format/i)
    expect(existsSync(outsidePath)).toBe(false)
  })

  test('approval.resolve injects the decision into the active orchestrator stdin', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-relay-approval-'))
    const workspacePath = join(dataDir, 'workspace')
    mkdirSync(workspacePath, { recursive: true })
    tempDirs.push(dataDir)

    const store = createRuntimeStore({ agentManager: createAgentManager(), dataDir })
    stores.push(store)
    const workspace = store.createWorkspace(workspacePath, 'Relay Approval')
    const orchestratorId = `${workspace.id}:orchestrator`
    const orchScript = join(workspacePath, 'orch-relay-approval-echo.js')
    writeFileSync(
      orchScript,
      [
        "process.stdin.setEncoding('utf8')",
        "process.stdin.on('data', (chunk) => process.stdout.write('ORCH:' + chunk))",
      ].join('\n'),
      'utf8'
    )
    store.configureAgentLaunch(workspace.id, orchestratorId, {
      args: ['-lc', `"${process.execPath}" "${orchScript}"`],
      command: '/bin/bash',
    })
    const run = await store.startAgent(workspace.id, orchestratorId, { hivePort: '4010' })
    const approval = store.approvalLedger.create({
      action: 'Run production migration',
      chatId: 'relay-chat',
      messageId: 'relay-message',
      orchAgentId: orchestratorId,
      risk: 'high',
      target: null,
      workspaceId: workspace.id,
    })
    const handler = createRelayRpcHandler({
      runtimeInfo: { dataDir, port: 0 },
      store,
    })

    await expect(
      handler(
        'approval.resolve',
        { approval_id: approval.approvalId, decision: 'deny' },
        'device-1',
        ['approve_risk']
      )
    ).resolves.toMatchObject({ approval_id: approval.approvalId, decision: 'deny', ok: true })

    await waitFor(() => {
      const activeRun = store.getLiveRun(run.runId)
      expect(activeRun.output).toContain(`approval_id=${approval.approvalId} DENIED`)
      expect(activeRun.output).toContain('action: Run production migration')
    })
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
