import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'
import WebSocket from 'ws'

import { startTestServer } from '../helpers/test-server.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const createWorkspaceFixture = () => {
  const workspacePath = mkdtempSync(join(tmpdir(), 'hive-mobile-workspace-'))
  tempDirs.push(workspacePath)
  mkdirSync(join(workspacePath, '.hive'), { recursive: true })
  writeFileSync(
    join(workspacePath, '.hive', 'plan.md'),
    `---
title: Mobile Dashboard
current_phase: m19a-lan-dashboard
---

## 里程碑

### M19a · LAN read-only dashboard · in_progress
- [x] protocol audit
- [ ] mobile API

### M19b · Device control · proposed
- [ ] scoped send

## 当前 phase
m19a-lan-dashboard
`,
    'utf8'
  )
  writeFileSync(
    join(workspacePath, '.hive', 'tasks.md'),
    `# Tasks

## In progress

- [ ] Build mobile API

## Done

- [x] Protocol audit
`,
    'utf8'
  )
  return workspacePath
}

const pairMobile = async (baseUrl: string) => {
  const response = await fetch(`${baseUrl}/api/mobile/pair`)
  const body = (await response.json()) as { host: string; port: number; token: string }
  expect(response.status).toBe(200)
  expect(body.token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
  expect(body.host).toBe('127.0.0.1')
  expect(typeof body.port).toBe('number')
  return body
}

const mobileHeaders = (token: string, host?: string) => ({
  authorization: `Bearer ${token}`,
  ...(host ? { host } : {}),
})

const toWsUrl = (baseUrl: string, path: string) => baseUrl.replace('http://', 'ws://') + path

const waitForMessage = async <T>(socket: WebSocket) =>
  new Promise<T>((resolve, reject) => {
    socket.once('message', (chunk) => {
      try {
        resolve(JSON.parse(chunk.toString()) as T)
      } catch (error) {
        reject(error)
      }
    })
    socket.once('error', reject)
  })

describe('mobile API', () => {
  test('pairs a persistent bearer token from localhost only', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-mobile-data-'))
    tempDirs.push(dataDir)
    const server = await startTestServer({ dataDir })
    const blockedRemotePair = await fetch(`${server.baseUrl}/api/mobile/pair`, {
      headers: { origin: 'http://192.168.1.44:4010' },
    })
    expect(blockedRemotePair.status).toBe(403)
    const first = await pairMobile(server.baseUrl)
    await server.close()

    const restarted = await startTestServer({ dataDir })
    try {
      const second = await pairMobile(restarted.baseUrl)
      expect(second.token).toBe(first.token)
    } finally {
      await restarted.close()
    }
  })

  test('requires bearer auth for mobile routes and allows authenticated LAN Host headers', async () => {
    const server = await startTestServer()
    try {
      const { token } = await pairMobile(server.baseUrl)

      const missing = await fetch(`${server.baseUrl}/api/mobile/workspaces`)
      expect(missing.status).toBe(401)

      const wrong = await fetch(`${server.baseUrl}/api/mobile/workspaces`, {
        headers: mobileHeaders('not-the-token'),
      })
      expect(wrong.status).toBe(401)

      const nonLocalHost = await fetch(`${server.baseUrl}/api/mobile/workspaces`, {
        headers: mobileHeaders(token, '192.168.1.44:4010'),
      })
      expect(nonLocalHost.status).toBe(200)
      expect(await nonLocalHost.json()).toEqual([])
    } finally {
      await server.close()
    }
  })

  test('returns a compact dashboard aggregate for a paired mobile client', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Test')
      server.store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
      const { token } = await pairMobile(server.baseUrl)

      const response = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/dashboard`,
        { headers: mobileHeaders(token, '192.168.1.44:4010') }
      )
      const body = (await response.json()) as {
        cockpit: {
          ai_actions_count: number
          baseline_stale: boolean
          high_ai_actions: number
          open_questions: number
        }
        generated_at: string
        plan: { active_milestone: string | null; current_phase: string | null }
        runs: Array<{ agent_name: string; id: string; started_at: string | null; status: string }>
        tasks: { total_done: number; total_open: number }
        workers: Array<{
          id: string
          name: string
          preset: string | null
          role: string
          status: string
        }>
        workspace: { id: string; name: string; path: string }
      }

      expect(response.status).toBe(200)
      expect(body.workspace).toEqual({ id: workspace.id, name: 'Mobile Test', path: workspacePath })
      expect(body.plan).toEqual({
        active_milestone: 'M19a · LAN read-only dashboard',
        current_phase: 'm19a-lan-dashboard',
      })
      expect(body.tasks).toEqual({ total_done: 1, total_open: 1 })
      expect(body.workers).toHaveLength(1)
      expect(body.workers[0]).toMatchObject({
        name: 'Alice',
        preset: null,
        role: 'coder',
        status: 'stopped',
      })
      expect(body.runs).toEqual([])
      expect(body.cockpit.open_questions).toBe(0)
      expect(body.cockpit.ai_actions_count).toBeGreaterThanOrEqual(0)
      expect(body.cockpit.high_ai_actions).toBeGreaterThanOrEqual(0)
      expect(typeof body.cockpit.baseline_stale).toBe('boolean')
      expect(new Date(body.generated_at).toString()).not.toBe('Invalid Date')
    } finally {
      await server.close()
    }
  })

  test('streams mobile dashboard snapshots over websocket with query token auth', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile WS')
      const { token } = await pairMobile(server.baseUrl)

      const unauthorized = new WebSocket(
        toWsUrl(server.baseUrl, `/ws/mobile/workspaces/${workspace.id}/dashboard?token=wrong`)
      )
      await new Promise<void>((resolve, reject) => {
        unauthorized.once('unexpected-response', (_request, response) => {
          try {
            expect(response.statusCode).toBe(401)
            response.resume()
            resolve()
          } catch (error) {
            reject(error)
          }
        })
        unauthorized.once('open', () => reject(new Error('Expected unauthorized mobile ws')))
        unauthorized.once('error', () => {})
      })

      const socket = new WebSocket(
        toWsUrl(server.baseUrl, `/ws/mobile/workspaces/${workspace.id}/dashboard?token=${token}`),
        { headers: { host: '192.168.1.44:4010' } }
      )
      const payload = await waitForMessage<{
        kind: string
        payload: { plan: { current_phase: string | null }; workspace: { id: string } }
      }>(socket)

      expect(payload.kind).toBe('mobile-dashboard-snapshot')
      expect(payload.payload.workspace.id).toBe(workspace.id)
      expect(payload.payload.plan.current_phase).toBe('m19a-lan-dashboard')

      socket.close()
    } finally {
      await server.close()
    }
  })
})
