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

const setupServer = async (transport: FeishuOutboundTransport | null = null) => {
  const agentManager = createAgentManager()
  const store = createRuntimeStore({ agentManager })
  const app = createApp({ feishuTransport: transport, store })

  await new Promise<void>((resolve) => {
    app.server.listen(0, '127.0.0.1', () => resolve())
  })
  servers.push(app.server)

  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('No port')
  const baseUrl = `http://127.0.0.1:${address.port}`

  const workspacePath = mkdtempSync(join(tmpdir(), 'hive-feishu-ui-'))
  tempDirs.push(workspacePath)
  const workspace = store.createWorkspace(workspacePath, 'UI Test')

  const uiToken = store.getUiToken()

  return { baseUrl, store, uiToken, workspace }
}

const uiHeaders = (token: string) => ({ cookie: `hive_ui_token=${token}` })

const fetchJson = async (url: string, init: RequestInit = {}) => {
  const response = await fetch(url, init)
  const body = (await response.json()) as Record<string, unknown>
  return { body, status: response.status }
}

describe('GET /api/feishu/transport-status', () => {
  test('returns 403 when UI token is missing', async () => {
    const { baseUrl } = await setupServer(null)
    const { status } = await fetchJson(`${baseUrl}/api/feishu/transport-status`)
    expect(status).toBe(403)
  })

  test('returns 403 when UI token is wrong', async () => {
    const { baseUrl } = await setupServer(null)
    const { status } = await fetchJson(`${baseUrl}/api/feishu/transport-status`, {
      headers: uiHeaders('bad-token'),
    })
    expect(status).toBe(403)
  })

  test('returns status disabled when transport is null', async () => {
    const { baseUrl, uiToken } = await setupServer(null)
    const { body, status } = await fetchJson(`${baseUrl}/api/feishu/transport-status`, {
      headers: uiHeaders(uiToken),
    })
    expect(status).toBe(200)
    expect(body).toEqual({ status: 'disabled' })
  })

  test('returns connected status with appId and reconnectCount', async () => {
    const fakeTransport: FeishuOutboundTransport = {
      getLastChatForAgent: vi.fn().mockReturnValue(null),
      getStatus: vi.fn().mockReturnValue({
        appId: 'cli_test123',
        reconnectCount: 0,
        state: 'connected',
      }),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    }
    const { baseUrl, uiToken } = await setupServer(fakeTransport)
    const { body, status } = await fetchJson(`${baseUrl}/api/feishu/transport-status`, {
      headers: uiHeaders(uiToken),
    })
    expect(status).toBe(200)
    expect(body).toEqual({ appId: 'cli_test123', reconnectCount: 0, status: 'connected' })
  })

  test('returns disconnected status when transport is reconnecting', async () => {
    const fakeTransport: FeishuOutboundTransport = {
      getLastChatForAgent: vi.fn().mockReturnValue(null),
      getStatus: vi.fn().mockReturnValue({
        appId: 'cli_test456',
        reconnectCount: 3,
        state: 'disconnected',
      }),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    }
    const { baseUrl, uiToken } = await setupServer(fakeTransport)
    const { body, status } = await fetchJson(`${baseUrl}/api/feishu/transport-status`, {
      headers: uiHeaders(uiToken),
    })
    expect(status).toBe(200)
    expect(body).toEqual({ appId: 'cli_test456', reconnectCount: 3, status: 'disconnected' })
  })

  test('returns error status', async () => {
    const fakeTransport: FeishuOutboundTransport = {
      getLastChatForAgent: vi.fn().mockReturnValue(null),
      getStatus: vi.fn().mockReturnValue({
        appId: 'cli_test789',
        reconnectCount: 11,
        state: 'error',
      }),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    }
    const { baseUrl, uiToken } = await setupServer(fakeTransport)
    const { body, status } = await fetchJson(`${baseUrl}/api/feishu/transport-status`, {
      headers: uiHeaders(uiToken),
    })
    expect(status).toBe(200)
    expect(body).toEqual({ appId: 'cli_test789', reconnectCount: 11, status: 'error' })
  })
})

describe('GET /api/feishu/bindings', () => {
  test('returns 403 when UI token is missing', async () => {
    const { baseUrl } = await setupServer(null)
    const { status } = await fetchJson(`${baseUrl}/api/feishu/bindings`)
    expect(status).toBe(403)
  })

  test('returns empty list when no bindings exist', async () => {
    const { baseUrl, uiToken } = await setupServer(null)
    const { body, status } = await fetchJson(`${baseUrl}/api/feishu/bindings`, {
      headers: uiHeaders(uiToken),
    })
    expect(status).toBe(200)
    expect(body).toEqual([])
  })

  test('returns all bindings when no workspaceId query param', async () => {
    const { baseUrl, store, uiToken, workspace } = await setupServer(null)
    store.bindFeishuChat({ chatId: 'oc_a', workspaceId: workspace.id })
    store.bindFeishuChat({ chatId: 'oc_b', workspaceId: workspace.id })

    const { body, status } = await fetchJson(`${baseUrl}/api/feishu/bindings`, {
      headers: uiHeaders(uiToken),
    })
    expect(status).toBe(200)
    const bindings = body as Array<Record<string, unknown>>
    expect(bindings).toHaveLength(2)
    const chatIds = bindings.map((b) => b.chatId).sort()
    expect(chatIds).toEqual(['oc_a', 'oc_b'])
  })

  test('filters bindings by workspaceId query param', async () => {
    const { baseUrl, store, uiToken, workspace } = await setupServer(null)

    const otherPath = mkdtempSync(join(tmpdir(), 'hive-feishu-ui2-'))
    tempDirs.push(otherPath)
    const otherWorkspace = store.createWorkspace(otherPath, 'Other WS')

    store.bindFeishuChat({ chatId: 'oc_a', workspaceId: workspace.id })
    store.bindFeishuChat({ chatId: 'oc_b', workspaceId: otherWorkspace.id })

    const { body, status } = await fetchJson(
      `${baseUrl}/api/feishu/bindings?workspaceId=${workspace.id}`,
      { headers: uiHeaders(uiToken) }
    )
    expect(status).toBe(200)
    const bindings = body as Array<Record<string, unknown>>
    expect(bindings).toHaveLength(1)
    expect(bindings[0].chatId).toBe('oc_a')
  })
})

describe('POST /api/feishu/bindings', () => {
  test('returns 403 when UI token is missing', async () => {
    const { baseUrl } = await setupServer(null)
    const { status } = await fetchJson(`${baseUrl}/api/feishu/bindings`, {
      body: JSON.stringify({ chatId: 'oc_x', workspaceId: 'ws_x' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(status).toBe(403)
  })

  test('returns 400 when workspaceId is missing', async () => {
    const { baseUrl, uiToken } = await setupServer(null)
    const { body, status } = await fetchJson(`${baseUrl}/api/feishu/bindings`, {
      body: JSON.stringify({ chatId: 'oc_x' }),
      headers: { 'content-type': 'application/json', ...uiHeaders(uiToken) },
      method: 'POST',
    })
    expect(status).toBe(400)
    expect(body.error).toContain('Missing workspaceId')
  })

  test('returns 400 when chatId is missing', async () => {
    const { baseUrl, uiToken, workspace } = await setupServer(null)
    const { body, status } = await fetchJson(`${baseUrl}/api/feishu/bindings`, {
      body: JSON.stringify({ workspaceId: workspace.id }),
      headers: { 'content-type': 'application/json', ...uiHeaders(uiToken) },
      method: 'POST',
    })
    expect(status).toBe(400)
    expect(body.error).toContain('Missing chatId')
  })

  test('returns 201 with binding object on success', async () => {
    const { baseUrl, uiToken, workspace } = await setupServer(null)
    const { body, status } = await fetchJson(`${baseUrl}/api/feishu/bindings`, {
      body: JSON.stringify({ chatId: 'oc_new', chatName: 'Test Chat', workspaceId: workspace.id }),
      headers: { 'content-type': 'application/json', ...uiHeaders(uiToken) },
      method: 'POST',
    })
    expect(status).toBe(201)
    expect(body).toMatchObject({
      chatId: 'oc_new',
      chatName: 'Test Chat',
      enabled: true,
      workspaceId: workspace.id,
    })
    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('createdAt')
  })

  test('returns 500 when workspace does not exist', async () => {
    const { baseUrl, uiToken } = await setupServer(null)
    const { status } = await fetchJson(`${baseUrl}/api/feishu/bindings`, {
      body: JSON.stringify({ chatId: 'oc_x', workspaceId: 'nonexistent-ws-id' }),
      headers: { 'content-type': 'application/json', ...uiHeaders(uiToken) },
      method: 'POST',
    })
    expect(status).toBe(500)
  })

  test('returns 409 on duplicate chatId bound to different workspace', async () => {
    const { baseUrl, store, uiToken, workspace } = await setupServer(null)

    const otherPath = mkdtempSync(join(tmpdir(), 'hive-feishu-ui3-'))
    tempDirs.push(otherPath)
    const otherWorkspace = store.createWorkspace(otherPath, 'WS 2')

    store.bindFeishuChat({ chatId: 'oc_dup', workspaceId: workspace.id })

    const { status } = await fetchJson(`${baseUrl}/api/feishu/bindings`, {
      body: JSON.stringify({ chatId: 'oc_dup', workspaceId: otherWorkspace.id }),
      headers: { 'content-type': 'application/json', ...uiHeaders(uiToken) },
      method: 'POST',
    })
    expect(status).toBe(409)
  })
})

describe('DELETE /api/feishu/bindings/:chatId', () => {
  test('returns 403 when UI token is missing', async () => {
    const { baseUrl } = await setupServer(null)
    const { status } = await fetchJson(`${baseUrl}/api/feishu/bindings/oc_x`, { method: 'DELETE' })
    expect(status).toBe(403)
  })

  test('returns 200 with deleted true when binding exists', async () => {
    const { baseUrl, store, uiToken, workspace } = await setupServer(null)
    store.bindFeishuChat({ chatId: 'oc_del', workspaceId: workspace.id })

    const { body, status } = await fetchJson(`${baseUrl}/api/feishu/bindings/oc_del`, {
      headers: uiHeaders(uiToken),
      method: 'DELETE',
    })
    expect(status).toBe(200)
    expect(body).toEqual({ deleted: true })
  })

  test('returns 200 with deleted false when binding does not exist', async () => {
    const { baseUrl, uiToken } = await setupServer(null)
    const { body, status } = await fetchJson(`${baseUrl}/api/feishu/bindings/oc_nonexistent`, {
      headers: uiHeaders(uiToken),
      method: 'DELETE',
    })
    expect(status).toBe(200)
    expect(body).toEqual({ deleted: false })
  })
})
