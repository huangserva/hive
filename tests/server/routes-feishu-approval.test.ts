import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

import { createAgentManager } from '../../src/server/agent-manager.js'
import { createApp } from '../../src/server/app.js'
import type { FeishuOutboundTransport } from '../../src/server/feishu-transport.js'
import { createRuntimeStore } from '../../src/server/runtime-store.js'

const servers: Array<{ close: () => void }> = []
const tempDirs: string[] = []

afterEach(() => {
  while (servers.length > 0) {
    servers.pop()?.close()
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const postApproval = async (
  baseUrl: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
  fetchImpl: typeof fetch = fetch
) => {
  const response = await fetchImpl(`${baseUrl}/internal/feishu/approval-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return { body: (await response.json()) as Record<string, unknown>, status: response.status }
}

const authHeaders = (agentId: string, token: string) => ({
  'x-hive-agent-id': agentId,
  authorization: `Bearer ${token}`,
})

const SLEEP_COMMAND = '/bin/bash'
const SLEEP_ARGS = ['-c', 'exec cat']

const setupApprovalTest = async (transportOverrides: Partial<FeishuOutboundTransport> = {}) => {
  const sendApprovalCard = vi
    .fn<FeishuOutboundTransport['sendApprovalCard']>()
    .mockResolvedValue({ messageId: 'msg_001' })
  const fakeTransport = {
    getLastChatForAgent: vi.fn().mockReturnValue('oc_default'),
    getStatus: vi
      .fn()
      .mockReturnValue({ appId: 'cli_test', reconnectCount: 0, state: 'connected' }),
    sendApprovalCard,
    sendMessage: vi.fn().mockResolvedValue(undefined),
    updateApprovalCard: vi.fn().mockResolvedValue(undefined),
    ...transportOverrides,
  } as unknown as FeishuOutboundTransport

  const agentManager = createAgentManager()
  const store = createRuntimeStore({ agentManager })
  const app = createApp({ feishuTransport: fakeTransport, store })

  await new Promise<void>((resolve) => {
    app.server.listen(0, '127.0.0.1', () => resolve())
  })
  servers.push(app.server)

  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('No port')
  const baseUrl = `http://127.0.0.1:${address.port}`

  const workspacePath = mkdtempSync(join(tmpdir(), 'hive-approval-'))
  tempDirs.push(workspacePath)
  const workspace = store.createWorkspace(workspacePath, 'Approval WS')

  const worker = store.addWorker(workspace.id, { name: 'Orch', role: 'orchestrator' })
  store.configureAgentLaunch(workspace.id, worker.id, {
    args: SLEEP_ARGS,
    command: SLEEP_COMMAND,
    commandPresetId: null,
  })

  await store.startAgent(workspace.id, worker.id, { hivePort: String(address.port) })
  const token = store.peekAgentToken(worker.id)
  if (!token) throw new Error('No agent token')

  return {
    agentId: worker.id,
    baseUrl,
    sendApprovalCard,
    store,
    token,
    workspace,
  }
}

describe('POST /internal/feishu/approval-request', () => {
  test('returns 401 when agent identity header is missing', async () => {
    const { baseUrl, token } = await setupApprovalTest()
    const { status, body } = await postApproval(
      baseUrl,
      { action: 'deploy', workspaceId: 'ws-1' },
      { authorization: `Bearer ${token}` }
    )
    expect(status).toBe(401)
    expect(body.error).toContain('Missing agent identity')
  })

  test('returns 401 when agent token is wrong', async () => {
    const { agentId, baseUrl } = await setupApprovalTest()
    const { status, body } = await postApproval(
      baseUrl,
      { action: 'deploy', workspaceId: 'ws-1' },
      { 'x-hive-agent-id': agentId, authorization: 'Bearer wrong-token' }
    )
    expect(status).toBe(401)
    expect(body.error).toContain('Invalid or missing agent token')
  })

  test('returns 503 when feishuTransport is null', async () => {
    const agentManager = createAgentManager()
    const store = createRuntimeStore({ agentManager })
    const app = createApp({ feishuTransport: null, store })

    await new Promise<void>((resolve) => {
      app.server.listen(0, '127.0.0.1', () => resolve())
    })
    servers.push(app.server)
    const address = app.server.address()
    if (!address || typeof address === 'string') throw new Error('No port')
    const baseUrl = `http://127.0.0.1:${address.port}`

    const wsPath = mkdtempSync(join(tmpdir(), 'hive-appr-null-'))
    tempDirs.push(wsPath)
    const ws = store.createWorkspace(wsPath, 'Null')
    const worker = store.addWorker(ws.id, { name: 'Orch', role: 'orchestrator' })
    store.configureAgentLaunch(ws.id, worker.id, {
      args: SLEEP_ARGS,
      command: SLEEP_COMMAND,
      commandPresetId: null,
    })
    await store.startAgent(ws.id, worker.id, { hivePort: String(address.port) })
    const token = store.peekAgentToken(worker.id)
    if (!token) throw new Error('No token')

    const { status, body } = await postApproval(
      baseUrl,
      { action: 'deploy', workspaceId: ws.id },
      authHeaders(worker.id, token)
    )
    expect(status).toBe(503)
    expect(body.error).toContain('feishu transport not configured')
  })

  test('returns 400 when action is missing', async () => {
    const { agentId, baseUrl, token, workspace } = await setupApprovalTest()
    const { status, body } = await postApproval(
      baseUrl,
      { workspaceId: workspace.id },
      authHeaders(agentId, token)
    )
    expect(status).toBe(400)
    expect(body.error).toContain('Missing action')
  })

  test('returns 400 when workspaceId is missing', async () => {
    const { agentId, baseUrl, token } = await setupApprovalTest()
    const { status, body } = await postApproval(
      baseUrl,
      { action: 'deploy' },
      authHeaders(agentId, token)
    )
    expect(status).toBe(400)
    expect(body.error).toContain('Missing workspaceId')
  })

  test('defaults risk to high when omitted', async () => {
    const { agentId, baseUrl, sendApprovalCard, token, workspace } = await setupApprovalTest()
    const { status } = await postApproval(
      baseUrl,
      { action: 'deploy', workspaceId: workspace.id },
      authHeaders(agentId, token)
    )
    expect(status).toBe(200)
    expect(sendApprovalCard).toHaveBeenCalledWith(expect.objectContaining({ risk: 'high' }))
  })

  test('returns 400 when no chatId and no last chat for agent', async () => {
    const { agentId, baseUrl, token, workspace } = await setupApprovalTest({
      getLastChatForAgent: vi.fn().mockReturnValue(null),
    })
    const { status, body } = await postApproval(
      baseUrl,
      { action: 'deploy', workspaceId: workspace.id },
      authHeaders(agentId, token)
    )
    expect(status).toBe(400)
    expect(body.error).toContain('no recent feishu chat for this agent')
  })

  test('200 happy path calls sendApprovalCard with correct parameters', async () => {
    const { agentId, baseUrl, sendApprovalCard, token, workspace } = await setupApprovalTest()
    const { status, body } = await postApproval(
      baseUrl,
      {
        action: 'delete old files',
        chatId: 'oc_target',
        risk: 'medium',
        target: '关羽',
        workspaceId: workspace.id,
      },
      authHeaders(agentId, token)
    )
    expect(status).toBe(200)
    expect(sendApprovalCard).toHaveBeenCalledWith({
      action: 'delete old files',
      approvalId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      ),
      chatId: 'oc_target',
      risk: 'medium',
      target: '关羽',
      workspaceName: 'Approval WS',
    })
    expect(body.approval_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(body.message_id).toBe('msg_001')
  })

  test('approval creation sends a mobile approval push to devices with push tokens', async () => {
    const sentBodies: unknown[] = []
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      sentBodies.push(JSON.parse(String(init?.body ?? '[]')) as unknown)
      return Response.json({ data: [{ status: 'ok' }] })
    })
    const serverFetch = globalThis.fetch
    globalThis.fetch = fetchImpl as typeof fetch

    try {
      const { agentId, baseUrl, token, workspace, store } = await setupApprovalTest()
      const mobileDevice = store.createMobileDeviceToken('Mobile device', ['read_dashboard'])
      store.updateMobilePushToken(mobileDevice.device.id, 'ExponentPushToken[mobile]')
      const { status, body } = await postApproval(
        baseUrl,
        {
          action: 'Delete generated files',
          chatId: 'oc_target',
          risk: 'high',
          target: 'Alice',
          workspaceId: workspace.id,
        },
        authHeaders(agentId, token),
        serverFetch
      )
      expect(status).toBe(200)
      expect(body).toEqual(expect.objectContaining({ approval_id: expect.any(String) }))
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(sentBodies.at(-1)).toEqual([
        expect.objectContaining({
          body: 'Delete generated files',
          data: {
            action: 'Delete generated files',
            approvalId: body.approval_id,
            type: 'approval',
            workspaceId: workspace.id,
          },
          title: 'Approval required',
          to: 'ExponentPushToken[mobile]',
        }),
      ])
    } finally {
      globalThis.fetch = serverFetch
    }
  })

  test('200 uses last chat when chatId is omitted', async () => {
    const getLastChatForAgent = vi.fn().mockReturnValue('oc_last_chat')
    const { agentId, baseUrl, sendApprovalCard, token, workspace } = await setupApprovalTest({
      getLastChatForAgent,
    })
    const { status } = await postApproval(
      baseUrl,
      { action: 'reboot', workspaceId: workspace.id },
      authHeaders(agentId, token)
    )
    expect(status).toBe(200)
    expect(getLastChatForAgent).toHaveBeenCalledWith(agentId)
    expect(sendApprovalCard).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'oc_last_chat' })
    )
  })

  test('returns 500 when sendApprovalCard throws', async () => {
    const { agentId, baseUrl, token, workspace } = await setupApprovalTest({
      sendApprovalCard: vi.fn().mockRejectedValue(new Error('SDK network error')),
    })
    const { status, body } = await postApproval(
      baseUrl,
      { action: 'deploy', workspaceId: workspace.id, chatId: 'oc_1' },
      authHeaders(agentId, token)
    )
    expect(status).toBe(500)
    expect(body.error).toContain('SDK network error')
  })
})
