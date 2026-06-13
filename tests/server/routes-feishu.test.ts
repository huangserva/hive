import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

import { createAgentManager } from '../../src/server/agent-manager.js'
import { createApp } from '../../src/server/app.js'
import type { FeishuTransport } from '../../src/server/feishu-transport.js'
import { createRuntimeStore } from '../../src/server/runtime-store.js'

const servers: Array<{ close: () => void }> = []
const tempDirs: string[] = []

afterEach(() => {
  while (servers.length > 0) {
    servers.pop()?.close()
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const SLEEP_COMMAND = '/bin/bash'
const SLEEP_ARGS = ['-c', 'exec cat']

const postOutbound = async (
  baseUrl: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
) => {
  const response = await fetch(`${baseUrl}/internal/feishu/outbound`, {
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

const setupWithTransport = async (transportOverrides: Partial<FeishuTransport> = {}) => {
  const agentManager = createAgentManager()
  const store = createRuntimeStore({ agentManager })
  const sendMessage = vi.fn().mockResolvedValue(undefined)
  // M44 B1: 默认 sendMedia 也 fake 上；如果路由本应该走 sendMessage，sendMedia 不该被调（断言守）。
  const sendMedia = vi.fn().mockResolvedValue({
    category: 'media',
    fileKey: 'fk',
    fileName: 'demo.mp4',
    imageKey: null,
    sentCaption: false,
  })
  const fakeTransport = {
    getLastChatForAgent: vi.fn().mockReturnValue(null),
    sendMedia,
    sendMessage,
    ...transportOverrides,
  } as unknown as FeishuTransport
  const app = createApp({ feishuTransport: fakeTransport, store })

  await new Promise<void>((resolve) => {
    app.server.listen(0, '127.0.0.1', () => resolve())
  })
  servers.push(app.server)

  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('No port')
  const baseUrl = `http://127.0.0.1:${address.port}`

  const workspacePath = mkdtempSync(join(tmpdir(), 'hive-feishu-route-'))
  tempDirs.push(workspacePath)
  const workspace = store.createWorkspace(workspacePath, 'Test')
  const worker = store.addWorker(workspace.id, { name: 'Orch', role: 'orchestrator' })

  store.configureAgentLaunch(workspace.id, worker.id, {
    command: SLEEP_COMMAND,
    args: SLEEP_ARGS,
    commandPresetId: null,
  })

  const run = await store.startAgent(workspace.id, worker.id, {
    hivePort: String(address.port),
  })
  const token = store.peekAgentToken(worker.id)
  if (!token) throw new Error('No agent token after start')

  return { agentId: worker.id, baseUrl, run, sendMedia, sendMessage, store, token }
}

describe('POST /internal/feishu/outbound', () => {
  test('returns 401 when agent identity header is missing', async () => {
    const { baseUrl, token } = await setupWithTransport()
    const { status, body } = await postOutbound(
      baseUrl,
      { text: 'hi' },
      {
        authorization: `Bearer ${token}`,
      }
    )
    expect(status).toBe(401)
    expect(body.error).toContain('Missing agent identity')
  })

  test('returns 401 when token is wrong', async () => {
    const { agentId, baseUrl } = await setupWithTransport()
    const { status, body } = await postOutbound(
      baseUrl,
      { text: 'hi' },
      {
        'x-hive-agent-id': agentId,
        authorization: 'Bearer wrong-token',
      }
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

    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-feishu-null-'))
    tempDirs.push(workspacePath)
    const workspace = store.createWorkspace(workspacePath, 'NoTransport')
    const worker = store.addWorker(workspace.id, { name: 'Orch', role: 'orchestrator' })
    store.configureAgentLaunch(workspace.id, worker.id, {
      command: SLEEP_COMMAND,
      args: SLEEP_ARGS,
      commandPresetId: null,
    })
    await store.startAgent(workspace.id, worker.id, {
      hivePort: String(address.port),
    })
    const token = store.peekAgentToken(worker.id)
    if (!token) throw new Error('No token')

    const { status, body } = await postOutbound(
      baseUrl,
      { text: 'hi' },
      authHeaders(worker.id, token)
    )
    expect(status).toBe(503)
    expect(body.error).toContain('feishu transport not configured')
  })

  test('returns 400 when text is missing', async () => {
    const { agentId, baseUrl, token } = await setupWithTransport()
    const { status, body } = await postOutbound(
      baseUrl,
      { chatId: 'oc_x' },
      authHeaders(agentId, token)
    )
    expect(status).toBe(400)
    expect(body.error).toContain('Missing text')
  })

  test('returns 400 when text is empty string', async () => {
    const { agentId, baseUrl, token } = await setupWithTransport()
    const { status, body } = await postOutbound(
      baseUrl,
      { text: '   ', chatId: 'oc_x' },
      authHeaders(agentId, token)
    )
    expect(status).toBe(400)
    expect(body.error).toContain('Missing text')
  })

  test('returns 400 when chatId is non-string', async () => {
    const { agentId, baseUrl, token } = await setupWithTransport()
    const { status, body } = await postOutbound(
      baseUrl,
      { text: 'hi', chatId: 123 },
      authHeaders(agentId, token)
    )
    expect(status).toBe(400)
    expect(body.error).toContain('chatId must be a non-empty string')
  })

  test('returns 400 when chatId is empty string', async () => {
    const { agentId, baseUrl, token } = await setupWithTransport()
    const { status, body } = await postOutbound(
      baseUrl,
      { text: 'hi', chatId: '  ' },
      authHeaders(agentId, token)
    )
    expect(status).toBe(400)
    expect(body.error).toContain('chatId must be a non-empty string')
  })

  test('returns 400 when chatId omitted and no last chat for agent', async () => {
    const { agentId, baseUrl, token } = await setupWithTransport()
    const { status, body } = await postOutbound(
      baseUrl,
      { text: 'hi' },
      authHeaders(agentId, token)
    )
    expect(status).toBe(400)
    expect(body.error).toContain('no recent feishu chat for this agent')
  })

  test('returns 200 and sends message when chatId is provided', async () => {
    const { agentId, baseUrl, sendMessage, token } = await setupWithTransport()
    const { status, body } = await postOutbound(
      baseUrl,
      { text: 'hello world', chatId: 'oc_target' },
      authHeaders(agentId, token)
    )
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(sendMessage).toHaveBeenCalledWith('oc_target', 'hello world')
  })

  test('uses last chat for agent when chatId is omitted', async () => {
    const getLastChatForAgent = vi.fn().mockReturnValue('oc_last')
    const { agentId, baseUrl, sendMessage, token } = await setupWithTransport({
      getLastChatForAgent,
    })
    const { status, body } = await postOutbound(
      baseUrl,
      { text: 'reply' },
      authHeaders(agentId, token)
    )
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(getLastChatForAgent).toHaveBeenCalledWith(agentId)
    expect(sendMessage).toHaveBeenCalledWith('oc_last', 'reply')
  })

  test('marks the source message delivered after a successful reply', async () => {
    const markReplyDelivered = vi.fn().mockResolvedValue(undefined)
    const { agentId, baseUrl, sendMessage, token } = await setupWithTransport({
      markReplyDelivered,
    })

    const { status, body } = await postOutbound(
      baseUrl,
      { text: 'reply', chatId: 'oc_target', messageId: 'om_source' },
      authHeaders(agentId, token)
    )

    expect(status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(sendMessage).toHaveBeenCalledWith('oc_target', 'reply')
    expect(markReplyDelivered).toHaveBeenCalledWith('om_source')
  })

  // M44 钟馗第二轮 blocking #1：真集成穿透 CLI→route→transport 的媒体路径，
  // 校验路由对 body.file 字段的真实分流（产品反 = 不调 sendMedia 仍走 sendMessage 这条假覆盖必须挂红）。
  test('M44 file 字段存在 + text caption → 调 sendMedia({chatId, filePath, caption})，不调 sendMessage', async () => {
    const { agentId, baseUrl, sendMedia, sendMessage, token } = await setupWithTransport()
    const { status, body } = await postOutbound(
      baseUrl,
      { file: '/abs/path/demo.mp4', text: '主管发的视频', chatId: 'oc_target' },
      authHeaders(agentId, token)
    )
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(sendMedia).toHaveBeenCalledTimes(1)
    expect(sendMedia).toHaveBeenCalledWith({
      caption: '主管发的视频',
      chatId: 'oc_target',
      filePath: '/abs/path/demo.mp4',
    })
    // 产品反（route 静默降级到 sendMessage）这条断言会挂红
    expect(sendMessage).not.toHaveBeenCalled()
  })

  test('M44 file 字段 + 无 text → sendMedia 不带 caption（且不调 sendMessage）', async () => {
    const { agentId, baseUrl, sendMedia, sendMessage, token } = await setupWithTransport()
    const { status, body } = await postOutbound(
      baseUrl,
      { file: '/abs/path/demo.mp4', chatId: 'oc_target' },
      authHeaders(agentId, token)
    )
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(sendMedia).toHaveBeenCalledTimes(1)
    const call = sendMedia.mock.calls[0]?.[0] as {
      caption?: string
      chatId: string
      filePath: string
    }
    expect(call.chatId).toBe('oc_target')
    expect(call.filePath).toBe('/abs/path/demo.mp4')
    expect(call.caption).toBeUndefined()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  test('M44 file 字段 + 空白 text → caption 省略（不传给 sendMedia，飞书只发媒体）', async () => {
    const { agentId, baseUrl, sendMedia, sendMessage, token } = await setupWithTransport()
    const { status, body } = await postOutbound(
      baseUrl,
      { file: '/abs/path/demo.mp4', text: '   ', chatId: 'oc_target' },
      authHeaders(agentId, token)
    )
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true })
    const call = sendMedia.mock.calls[0]?.[0] as { caption?: string }
    expect(call.caption).toBeUndefined()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  test('M44 file 字段 + messageId → media 发完仍 markReplyDelivered', async () => {
    const markReplyDelivered = vi.fn().mockResolvedValue(undefined)
    const { agentId, baseUrl, sendMedia, token } = await setupWithTransport({ markReplyDelivered })
    const { status } = await postOutbound(
      baseUrl,
      { file: '/abs/path/demo.mp4', chatId: 'oc_target', messageId: 'om_source' },
      authHeaders(agentId, token)
    )
    expect(status).toBe(200)
    expect(sendMedia).toHaveBeenCalledTimes(1)
    expect(markReplyDelivered).toHaveBeenCalledWith('om_source')
  })

  test('M44 file 字段是空串 → 400 BadRequest，不调 sendMedia / sendMessage', async () => {
    const { agentId, baseUrl, sendMedia, sendMessage, token } = await setupWithTransport()
    const { status } = await postOutbound(
      baseUrl,
      { file: '   ', chatId: 'oc_target' },
      authHeaders(agentId, token)
    )
    expect(status).toBe(400)
    expect(sendMedia).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
