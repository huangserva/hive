import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'
import WebSocket from 'ws'

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
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const PLAN_CONTENT = `---
title: WsCockpitTest
---

## 目标

Test cockpit websocket.`

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
})
