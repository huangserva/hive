import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'
import WebSocket from 'ws'

import type { RuntimeStore } from '../../src/server/runtime-store.js'
import { createTasksWebSocketServer } from '../../src/server/tasks-websocket-server.js'
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

const openSocket = async (url: string, cookie: string) => {
  return await new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { cookie } })
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}

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
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const listen = async (server: ReturnType<typeof createServer>) => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP address')
  return `ws://127.0.0.1:${address.port}`
}

describe('tasks watcher websocket', () => {
  test('rejects task watcher upgrades from non-local origins', async () => {
    const server = await startTestServer()
    try {
      const cookie = await getUiCookie(server.baseUrl)
      await expectUpgradeStatus(toWsUrl(server.baseUrl, '/ws/tasks/missing'), cookie, 403, {
        Origin: 'https://attacker.example',
      })
    } finally {
      await server.close()
    }
  })

  test('allows task watcher upgrades from a local origin before workspace lookup', async () => {
    const server = await startTestServer()
    try {
      const cookie = await getUiCookie(server.baseUrl)
      await expectUpgradeStatus(toWsUrl(server.baseUrl, '/ws/tasks/missing'), cookie, 404, {
        Origin: server.baseUrl,
      })
    } finally {
      await server.close()
    }
  })

  test('rejects task watcher upgrades from non-local hosts', async () => {
    const server = await startTestServer()
    try {
      const cookie = await getUiCookie(server.baseUrl)
      await expectUpgradeStatus(toWsUrl(server.baseUrl, '/ws/tasks/missing'), cookie, 403, {
        Host: 'attacker.example',
      })
    } finally {
      await server.close()
    }
  })

  test('external .hive/tasks.md change broadcasts tasks-updated over websocket', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-tasks-watcher-ws-'))
    tempDirs.push(workspacePath)
    mkdirSync(join(workspacePath, '.hive'), { recursive: true })
    writeFileSync(join(workspacePath, '.hive', 'tasks.md'), '- [ ] initial\n', 'utf8')

    const server = await startTestServer()
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const workspaceResponse = await fetch(`${server.baseUrl}/api/workspaces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ name: 'Alpha', path: workspacePath }),
      })
      expect(workspaceResponse.status).toBe(201)
      const workspace = (await workspaceResponse.json()) as { id: string }
      await server.store.startWorkspaceWatch(workspace.id)
      const socket = await openSocket(toWsUrl(server.baseUrl, `/ws/tasks/${workspace.id}`), cookie)
      const messages: string[] = []
      socket.on('message', (chunk) => messages.push(chunk.toString()))

      writeFileSync(join(workspacePath, '.hive', 'tasks.md'), '- [x] updated externally\n', 'utf8')

      await waitFor(() => {
        const payload = messages.map(
          (message) => JSON.parse(message) as { content: string; type: string }
        )
        expect(payload).toContainEqual({
          type: 'tasks-updated',
          content: '- [x] updated externally\n',
        })
      })

      socket.close()
    } finally {
      await server.close()
    }
  })

  test('external .hive/reports change broadcasts cockpit update over websocket', {
    timeout: 10000,
  }, async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-reports-watcher-ws-'))
    tempDirs.push(workspacePath)
    mkdirSync(join(workspacePath, '.hive', 'reports'), { recursive: true })
    writeFileSync(join(workspacePath, '.hive', 'tasks.md'), '- [ ] initial\n', 'utf8')
    writeFileSync(
      join(workspacePath, '.hive', 'plan.md'),
      `---
title: Report Watcher
---

## 目标

Watch reports.
`,
      'utf8'
    )

    const server = await startTestServer()
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const workspaceResponse = await fetch(`${server.baseUrl}/api/workspaces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ name: 'Reports', path: workspacePath }),
      })
      expect(workspaceResponse.status).toBe(201)
      const workspace = (await workspaceResponse.json()) as { id: string }
      await server.store.startWorkspaceWatch(workspace.id)

      const messages: string[] = []
      const socket = new WebSocket(toWsUrl(server.baseUrl, `/ws/cockpit/${workspace.id}`), {
        headers: { cookie },
      })
      socket.on('message', (chunk) => messages.push(chunk.toString()))
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve)
        socket.once('error', reject)
      })
      await waitFor(() => {
        const payload = messages.map((message) => JSON.parse(message) as { kind: string })
        expect(payload).toContainEqual(expect.objectContaining({ kind: 'cockpit-snapshot' }))
      })

      writeFileSync(
        join(workspacePath, '.hive', 'reports', '2026-05-29-new-report.html'),
        '<!doctype html><title>New Report</title>',
        'utf8'
      )

      await waitFor(() => {
        const payload = messages.map((message) => JSON.parse(message) as { kind: string })
        expect(payload).toContainEqual(expect.objectContaining({ kind: 'cockpit-update' }))
      })

      socket.close()
    } finally {
      await server.close()
    }
  })

  test('sends initial tasks snapshot before subscribing client to updates', async () => {
    const httpServer = createServer()
    const workspaceId = 'workspace-tasks-order'
    let tasksWs!: ReturnType<typeof createTasksWebSocketServer>
    tasksWs = createTasksWebSocketServer(
      httpServer,
      {
        getWorkspaceSnapshot: () => ({ summary: { path: '/tmp/hive-tasks-order' } }),
        validateUiToken: () => true,
      } as unknown as RuntimeStore,
      {
        readTasks: () => {
          tasksWs.publish(workspaceId, '- [x] update\n')
          return '- [ ] snapshot\n'
        },
      }
    )
    const baseUrl = await listen(httpServer)
    const messages: Array<{ type: string }> = []

    try {
      const socket = new WebSocket(`${baseUrl}/ws/tasks/${workspaceId}`, {
        headers: { cookie: 'hive_ui_token=test' },
      })
      socket.on('message', (chunk) => messages.push(JSON.parse(chunk.toString())))

      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve)
        socket.once('error', reject)
      })

      await waitFor(() => {
        expect(messages.length).toBeGreaterThanOrEqual(1)
        expect(messages[0]?.type).toBe('tasks-snapshot')
      })

      socket.close()
    } finally {
      tasksWs.close()
      httpServer.close()
    }
  })
})
