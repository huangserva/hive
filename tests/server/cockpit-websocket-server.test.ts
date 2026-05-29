import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'
import WebSocket from 'ws'

import { createCockpitWebSocketServer } from '../../src/server/cockpit-websocket-server.js'
import type { RuntimeStore } from '../../src/server/runtime-store.js'
import { startTestServer } from '../helpers/test-server.js'
import { getUiCookie } from '../helpers/ui-session.js'

const tempDirs: string[] = []

const waitFor = async (
  assertion: () => void | Promise<void>,
  timeoutMs = 4000,
  intervalMs = 25
) => {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() <= deadline) {
    try {
      await assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
  throw lastError
}

const toWsUrl = (baseUrl: string, suffix: string) => baseUrl.replace('http://', 'ws://') + suffix

const expectUpgradeStatus = async (
  url: string,
  cookie: string,
  statusCode: number,
  headers: Record<string, string> = {}
) => {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { cookie, ...headers } })
    socket.once('unexpected-response', (_request, response) => {
      try {
        expect(response.statusCode).toBe(statusCode)
        response.resume()
        resolve()
      } catch (error) {
        reject(error)
      }
    })
    socket.once('open', () => reject(new Error('Expected websocket upgrade to fail')))
    socket.once('error', () => {})
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const PLAN_CONTENT = `---
title: WsCockpitTest
---

## 目标

Test cockpit websocket.`

const listen = async (server: ReturnType<typeof createServer>) => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP address')
  return `ws://127.0.0.1:${address.port}`
}

describe('cockpit websocket server', () => {
  test('rejects cockpit upgrade without valid UI token', async () => {
    const server = await startTestServer()
    try {
      await expectUpgradeStatus(toWsUrl(server.baseUrl, '/ws/cockpit/nonexistent'), '', 401)
    } finally {
      await server.close()
    }
  })

  test('rejects cockpit upgrade with wrong UI token', async () => {
    const server = await startTestServer()
    try {
      await expectUpgradeStatus(
        toWsUrl(server.baseUrl, '/ws/cockpit/nonexistent'),
        'hive_ui_token=invalid',
        401
      )
    } finally {
      await server.close()
    }
  })

  test('rejects cockpit upgrade for nonexistent workspace (404)', async () => {
    const server = await startTestServer()
    try {
      const cookie = await getUiCookie(server.baseUrl)
      await expectUpgradeStatus(toWsUrl(server.baseUrl, '/ws/cockpit/nonexistent-id'), cookie, 404)
    } finally {
      await server.close()
    }
  })

  test('sends cockpit-snapshot on connect with valid workspace', { timeout: 10000 }, async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-cockpit-ws-'))
    tempDirs.push(workspacePath)
    mkdirSync(join(workspacePath, '.hive'), { recursive: true })
    writeFileSync(join(workspacePath, '.hive', 'plan.md'), PLAN_CONTENT, 'utf8')

    const server = await startTestServer()
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const workspace = server.store.createWorkspace(workspacePath, 'CockpitWS')

      const url = toWsUrl(server.baseUrl, `/ws/cockpit/${workspace.id}`)
      const messages: string[] = []
      const socket = await new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(url, { headers: { cookie } })
        ws.on('message', (chunk) => messages.push(chunk.toString()))
        ws.once('open', () => resolve(ws))
        ws.once('error', reject)
      })

      await waitFor(() => {
        expect(messages.length).toBeGreaterThanOrEqual(1)
        const payload = JSON.parse(messages[0] ?? '') as {
          kind: string
          payload: { plan: { frontmatter: { title: string } } }
        }
        expect(payload.kind).toBe('cockpit-snapshot')
        expect(payload.payload.plan.frontmatter.title).toBe('WsCockpitTest')
      })

      socket.close()
    } finally {
      await server.close()
    }
  })

  test('sends initial cockpit snapshot before subscribing client to updates', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-cockpit-order-'))
    tempDirs.push(workspacePath)
    mkdirSync(join(workspacePath, '.hive'), { recursive: true })
    writeFileSync(join(workspacePath, '.hive', 'plan.md'), PLAN_CONTENT, 'utf8')

    const httpServer = createServer()
    const workspaceId = 'workspace-cockpit-order'
    let cockpitWs!: ReturnType<typeof createCockpitWebSocketServer>
    let workspaceLookupCount = 0
    cockpitWs = createCockpitWebSocketServer(httpServer, {
      getWorkspaceSnapshot: () => {
        workspaceLookupCount += 1
        if (workspaceLookupCount === 2) {
          cockpitWs.publish(workspaceId)
        }
        return { summary: { path: workspacePath } }
      },
      validateUiToken: () => true,
    } as unknown as RuntimeStore)
    const baseUrl = await listen(httpServer)
    const messages: Array<{ kind: string }> = []

    try {
      const socket = new WebSocket(`${baseUrl}/ws/cockpit/${workspaceId}`, {
        headers: { cookie: 'hive_ui_token=test' },
      })
      socket.on('message', (chunk) => messages.push(JSON.parse(chunk.toString())))

      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve)
        socket.once('error', reject)
      })

      await waitFor(() => {
        expect(messages.length).toBeGreaterThanOrEqual(1)
        expect(messages[0]?.kind).toBe('cockpit-snapshot')
      })

      socket.close()
    } finally {
      cockpitWs.close()
      httpServer.close()
    }
  })

  test('continues publishing cockpit updates when one subscriber send throws', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-cockpit-publish-'))
    tempDirs.push(workspacePath)
    mkdirSync(join(workspacePath, '.hive'), { recursive: true })
    writeFileSync(join(workspacePath, '.hive', 'plan.md'), PLAN_CONTENT, 'utf8')

    const httpServer = createServer()
    const workspaceId = 'workspace-cockpit-publish'
    const cockpitWs = createCockpitWebSocketServer(httpServer, {
      getWorkspaceSnapshot: () => ({ summary: { path: workspacePath } }),
      validateUiToken: () => true,
    } as unknown as RuntimeStore)
    const baseUrl = await listen(httpServer)
    const firstMessages: Array<{ kind: string }> = []
    const secondMessages: Array<{ kind: string }> = []

    try {
      const first = new WebSocket(`${baseUrl}/ws/cockpit/${workspaceId}`, {
        headers: { cookie: 'hive_ui_token=test' },
      })
      const second = new WebSocket(`${baseUrl}/ws/cockpit/${workspaceId}`, {
        headers: { cookie: 'hive_ui_token=test' },
      })
      first.on('message', (chunk) => firstMessages.push(JSON.parse(chunk.toString())))
      second.on('message', (chunk) => secondMessages.push(JSON.parse(chunk.toString())))
      await Promise.all([
        new Promise<void>((resolve, reject) => {
          first.once('open', resolve)
          first.once('error', reject)
        }),
        new Promise<void>((resolve, reject) => {
          second.once('open', resolve)
          second.once('error', reject)
        }),
      ])

      await waitFor(() => {
        expect(firstMessages.some((message) => message.kind === 'cockpit-snapshot')).toBe(true)
        expect(secondMessages.some((message) => message.kind === 'cockpit-snapshot')).toBe(true)
      })

      const originalSend = WebSocket.prototype.send
      let shouldThrow = true
      vi.spyOn(WebSocket.prototype, 'send').mockImplementation(function sendWithOneFailure(
        data: WebSocket.RawData,
        ...args: Parameters<typeof originalSend> extends [unknown, ...infer Rest] ? Rest : never
      ) {
        const text = typeof data === 'string' ? data : data.toString()
        if (shouldThrow && text.includes('"cockpit-update"')) {
          shouldThrow = false
          throw new Error('simulated send failure')
        }
        return originalSend.call(this, data, ...args)
      } as typeof originalSend)

      cockpitWs.publish(workspaceId)

      await waitFor(() => {
        expect(secondMessages.some((message) => message.kind === 'cockpit-update')).toBe(true)
      })

      first.close()
      second.close()
    } finally {
      cockpitWs.close()
      httpServer.close()
    }
  })
})
