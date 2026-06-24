import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'
import WebSocket from 'ws'

import { createRelayRpcHandler } from '../../src/server/relay-rpc-handler.js'
import { startTestServer } from '../helpers/test-server.js'
import { getUiCookie } from '../helpers/ui-session.js'

const tempDirs: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const createWorkspaceFixture = () => {
  const workspacePath = mkdtempSync(join(tmpdir(), 'hive-spawn-redaction-ws-'))
  tempDirs.push(workspacePath)
  mkdirSync(join(workspacePath, '.hive'), { recursive: true })
  writeFileSync(join(workspacePath, '.hive', 'tasks.md'), '# Tasks\n\n## In progress\n\n', 'utf8')
  writeFileSync(join(workspacePath, '.hive', 'plan.md'), '# Plan\n', 'utf8')
  return workspacePath
}

const createMobileToken = async (baseUrl: string) => {
  const cookie = await getUiCookie(baseUrl)
  const response = await fetch(`${baseUrl}/api/mobile/tokens`, {
    body: JSON.stringify({ capabilities: ['read_dashboard'], name: 'Phone' }),
    headers: { 'content-type': 'application/json', cookie },
    method: 'POST',
  })
  const body = (await response.json()) as { token: string }
  expect(response.status).toBe(200)
  return body.token
}

const toWsUrl = (baseUrl: string, path: string) => baseUrl.replace('http://', 'ws://') + path

const waitForMessage = async <T>(socket: WebSocket) =>
  await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for ws message')), 5_000)
    socket.once('message', (data) => {
      clearTimeout(timeout)
      try {
        resolve(JSON.parse(data.toString()) as T)
      } catch (error) {
        reject(error)
      }
    })
    socket.once('error', reject)
  })

const parseEvent = (message: { content_json: string }) =>
  JSON.parse(message.content_json) as Record<string, unknown>

describe('dispatch_spawn_failed redaction at source', () => {
  test('redacts the raw spawn failure event before mobile REST, relay, and websocket surfaces read it', async () => {
    const secret = 'glm-visible-secret'
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-spawn-redaction-data-'))
    tempDirs.push(dataDir)
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer({ dataDir })
    let socket: WebSocket | null = null
    try {
      server.store.setSecret('GLM_API_KEY', secret)
      const workspace = server.store.createWorkspace(workspacePath, 'Spawn Redaction')
      const worker = server.store.addWorker(workspace.id, { name: '关羽', role: 'coder' })
      server.store.configureAgentLaunch(workspace.id, worker.id, {
        args: [],
        command: `/opt/${secret}/codex`,
        env: { PATH: `/usr/local/bin:${secret}:/safe/bin` },
      })

      const token = await createMobileToken(server.baseUrl)
      socket = new WebSocket(
        toWsUrl(server.baseUrl, `/ws/mobile/workspaces/${workspace.id}/dashboard?token=${token}`),
        { headers: { host: '192.168.1.44:4010' } }
      )
      await waitForMessage(socket)
      const websocketFramePromise = waitForMessage<{
        kind: string
        payload: { content_json: string; message_type: string }
      }>(socket)

      await expect(
        server.store.dispatchTask(workspace.id, worker.id, `Spawn should redact ${secret}`, {
          hivePort: '4010',
        })
      ).rejects.toThrow('CLI not found in PATH')

      const restResponse = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/chat/messages?limit=10`,
        {
          headers: {
            authorization: `Bearer ${token}`,
            host: '192.168.1.44:4010',
          },
        }
      )
      const restBody = (await restResponse.json()) as {
        messages: Array<{ content_json: string; message_type: string }>
      }
      expect(restResponse.status).toBe(200)

      const relayHandler = createRelayRpcHandler({
        runtimeInfo: { dataDir, port: 4010 },
        store: server.store,
      })
      const relayBody = (await relayHandler(
        'workspace.chat.messages',
        { limit: 10, workspace_id: workspace.id },
        'device-1',
        ['read_dashboard']
      )) as { messages: Array<{ content_json: string; message_type: string }> }

      const websocketFrame = await websocketFramePromise
      expect(websocketFrame.kind).toBe('mobile-chat-message')
      expect(websocketFrame.payload.message_type).toBe('system_event')

      const surfaces = [
        parseEvent(restBody.messages.at(-1) ?? { content_json: '{}' }),
        parseEvent(relayBody.messages.at(-1) ?? { content_json: '{}' }),
        parseEvent(websocketFrame.payload),
      ]

      for (const event of surfaces) {
        const serialized = JSON.stringify(event)
        expect(event.event).toBe('dispatch_spawn_failed')
        expect(serialized).not.toContain(secret)
        expect(serialized).toContain('[REDACTED]')
        expect(serialized).toContain('/usr/local/bin')
        expect(serialized).toContain('/safe/bin')
        expect(serialized).toContain('/opt/')
        expect(serialized).toContain('/codex')
        expect(serialized).toContain('CLI not found in PATH')
      }
    } finally {
      socket?.close()
      await server.close()
    }
  })
})
