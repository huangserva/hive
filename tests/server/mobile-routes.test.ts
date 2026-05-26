import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'
import WebSocket from 'ws'

import { startTestServer } from '../helpers/test-server.js'
import { getUiCookie } from '../helpers/ui-session.js'

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

const jsonHeaders = (input: { cookie?: string; host?: string; token?: string } = {}) => ({
  'content-type': 'application/json',
  ...(input.cookie ? { cookie: input.cookie } : {}),
  ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
  ...(input.host ? { host: input.host } : {}),
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

  test('generates and redeems scoped pairing codes over mobile endpoints', async () => {
    const server = await startTestServer()
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const blocked = await fetch(`${server.baseUrl}/api/mobile/pair/generate`, {
        headers: { origin: 'http://192.168.1.44:4010' },
        method: 'POST',
        body: JSON.stringify({ capabilities: ['read_dashboard'], device_name: 'Phone' }),
      })
      expect(blocked.status).toBe(403)

      const generated = await fetch(`${server.baseUrl}/api/mobile/pair/generate`, {
        headers: jsonHeaders({ cookie }),
        method: 'POST',
        body: JSON.stringify({ capabilities: ['read_dashboard'], device_name: 'Phone' }),
      })
      const generatedBody = (await generated.json()) as { code: string; expires_at: number }
      expect(generated.status).toBe(200)
      expect(generatedBody.code).toMatch(/^\d{6}$/)

      const redeemed = await fetch(`${server.baseUrl}/api/mobile/pair/redeem`, {
        headers: jsonHeaders({ host: '192.168.1.44:4010' }),
        method: 'POST',
        body: JSON.stringify({ code: generatedBody.code }),
      })
      const redeemedBody = (await redeemed.json()) as {
        device: { capabilities: string[]; name: string }
        token: string
      }
      expect(redeemed.status).toBe(200)
      expect(redeemedBody.token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
      expect(redeemedBody.device.name).toBe('Phone')
      expect(redeemedBody.device.capabilities).toEqual(['read_dashboard'])
    } finally {
      await server.close()
    }
  })

  test('gates mobile device registry by admin_runtime capability and revokes tokens', async () => {
    const server = await startTestServer()
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const admin = await pairMobile(server.baseUrl)
      const generated = await fetch(`${server.baseUrl}/api/mobile/pair/generate`, {
        headers: jsonHeaders({ cookie }),
        method: 'POST',
        body: JSON.stringify({ capabilities: ['read_dashboard'], device_name: 'Reader' }),
      })
      const { code } = (await generated.json()) as { code: string }
      const redeemed = await fetch(`${server.baseUrl}/api/mobile/pair/redeem`, {
        headers: jsonHeaders(),
        method: 'POST',
        body: JSON.stringify({ code }),
      })
      const reader = (await redeemed.json()) as { device: { id: string }; token: string }

      const forbidden = await fetch(`${server.baseUrl}/api/mobile/devices`, {
        headers: mobileHeaders(reader.token, '192.168.1.44:4010'),
      })
      expect(forbidden.status).toBe(403)

      const patched = await fetch(`${server.baseUrl}/api/mobile/devices/${reader.device.id}`, {
        headers: jsonHeaders({ host: '192.168.1.44:4010', token: admin.token }),
        method: 'PATCH',
        body: JSON.stringify({ capabilities: ['read_dashboard', 'send_prompt'], name: 'Reader 2' }),
      })
      expect(patched.status).toBe(200)

      const revoked = await fetch(`${server.baseUrl}/api/mobile/devices/${reader.device.id}`, {
        headers: mobileHeaders(admin.token, '192.168.1.44:4010'),
        method: 'DELETE',
      })
      expect(revoked.status).toBe(200)

      const afterRevoke = await fetch(`${server.baseUrl}/api/mobile/workspaces`, {
        headers: mobileHeaders(reader.token, '192.168.1.44:4010'),
      })
      expect(afterRevoke.status).toBe(410)
    } finally {
      await server.close()
    }
  })

  test('allows UI session auth to manage mobile devices', async () => {
    const server = await startTestServer()
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const mobile = await pairMobile(server.baseUrl)

      const listed = await fetch(`${server.baseUrl}/api/mobile/devices`, {
        headers: jsonHeaders({ cookie }),
      })
      const listedBody = (await listed.json()) as { devices: Array<{ id: string; name: string }> }
      expect(listed.status).toBe(200)
      expect(listedBody.devices).toContainEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: 'M19a mobile device',
        })
      )

      const deviceId = listedBody.devices[0]?.id
      expect(deviceId).toEqual(expect.any(String))

      const patched = await fetch(`${server.baseUrl}/api/mobile/devices/${deviceId}`, {
        headers: jsonHeaders({ cookie }),
        method: 'PATCH',
        body: JSON.stringify({ capabilities: ['read_dashboard'], name: 'UI Managed Phone' }),
      })
      const patchedBody = (await patched.json()) as {
        device: { capabilities: string[]; id: string; name: string }
      }
      expect(patched.status).toBe(200)
      expect(patchedBody.device).toMatchObject({
        capabilities: ['read_dashboard'],
        id: deviceId,
        name: 'UI Managed Phone',
      })

      const revoked = await fetch(`${server.baseUrl}/api/mobile/devices/${deviceId}`, {
        headers: jsonHeaders({ cookie }),
        method: 'DELETE',
      })
      expect(revoked.status).toBe(200)

      const afterRevoke = await fetch(`${server.baseUrl}/api/mobile/workspaces`, {
        headers: mobileHeaders(mobile.token, '192.168.1.44:4010'),
      })
      expect(afterRevoke.status).toBe(410)
    } finally {
      await server.close()
    }
  })

  test('requires send_prompt capability for mobile dispatch control', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Control')
      const worker = server.store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
      const readOnly = await fetch(`${server.baseUrl}/api/mobile/pair/generate`, {
        headers: jsonHeaders({ cookie }),
        method: 'POST',
        body: JSON.stringify({ capabilities: ['read_dashboard'], device_name: 'Reader' }),
      })
      const { code: readCode } = (await readOnly.json()) as { code: string }
      const readRedeemed = await fetch(`${server.baseUrl}/api/mobile/pair/redeem`, {
        headers: jsonHeaders(),
        method: 'POST',
        body: JSON.stringify({ code: readCode }),
      })
      const reader = (await readRedeemed.json()) as { token: string }

      const forbidden = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/dispatch`,
        {
          headers: jsonHeaders({ host: '192.168.1.44:4010', token: reader.token }),
          method: 'POST',
          body: JSON.stringify({ task: 'Do mobile task', worker_id: worker.id }),
        }
      )
      expect(forbidden.status).toBe(403)

      const senderPair = await fetch(`${server.baseUrl}/api/mobile/pair/generate`, {
        headers: jsonHeaders({ cookie }),
        method: 'POST',
        body: JSON.stringify({ capabilities: ['send_prompt'], device_name: 'Sender' }),
      })
      const { code } = (await senderPair.json()) as { code: string }
      const senderRedeemed = await fetch(`${server.baseUrl}/api/mobile/pair/redeem`, {
        headers: jsonHeaders(),
        method: 'POST',
        body: JSON.stringify({ code }),
      })
      const sender = (await senderRedeemed.json()) as { token: string }
      const dispatched = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/dispatch`,
        {
          headers: jsonHeaders({ host: '192.168.1.44:4010', token: sender.token }),
          method: 'POST',
          body: JSON.stringify({ task: 'Do mobile task', worker_id: worker.id }),
        }
      )
      const body = (await dispatched.json()) as { dispatch_id: string; pending_task_count: number }

      expect(dispatched.status).toBe(200)
      expect(body.dispatch_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
      expect(body.pending_task_count).toBe(1)
    } finally {
      await server.close()
    }
  })

  test('records mobile approval decisions with approve_risk capability', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Approval')
      const approval = server.store.approvalLedger.create({
        action: 'Remove generated files',
        chatId: 'oc_mobile',
        messageId: 'om_mobile',
        orchAgentId: `${workspace.id}:orchestrator`,
        risk: 'high',
        target: null,
        workspaceId: workspace.id,
      })

      const readOnlyPair = await fetch(`${server.baseUrl}/api/mobile/pair/generate`, {
        headers: jsonHeaders({ cookie }),
        method: 'POST',
        body: JSON.stringify({ capabilities: ['read_dashboard'], device_name: 'Reader' }),
      })
      const { code: readCode } = (await readOnlyPair.json()) as { code: string }
      const readRedeemed = await fetch(`${server.baseUrl}/api/mobile/pair/redeem`, {
        headers: jsonHeaders(),
        method: 'POST',
        body: JSON.stringify({ code: readCode }),
      })
      const reader = (await readRedeemed.json()) as { token: string }

      const forbidden = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/approve/${approval.approvalId}`,
        {
          headers: jsonHeaders({ host: '192.168.1.44:4010', token: reader.token }),
          method: 'POST',
          body: JSON.stringify({ decision: 'allow' }),
        }
      )
      expect(forbidden.status).toBe(403)

      const approverPair = await fetch(`${server.baseUrl}/api/mobile/pair/generate`, {
        headers: jsonHeaders({ cookie }),
        method: 'POST',
        body: JSON.stringify({ capabilities: ['approve_risk'], device_name: 'Approver' }),
      })
      const { code } = (await approverPair.json()) as { code: string }
      const approverRedeemed = await fetch(`${server.baseUrl}/api/mobile/pair/redeem`, {
        headers: jsonHeaders(),
        method: 'POST',
        body: JSON.stringify({ code }),
      })
      const approver = (await approverRedeemed.json()) as { token: string }

      const decided = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/approve/${approval.approvalId}`,
        {
          headers: jsonHeaders({ host: '192.168.1.44:4010', token: approver.token }),
          method: 'POST',
          body: JSON.stringify({ decision: 'allow' }),
        }
      )
      const body = (await decided.json()) as { approval_id: string; decision: string; ok: boolean }

      expect(decided.status).toBe(200)
      expect(body).toEqual({
        approval_id: approval.approvalId,
        decision: 'allow',
        ok: true,
        status: 'recorded',
      })
      expect(server.store.approvalLedger.get(approval.approvalId)).toBeNull()
    } finally {
      await server.close()
    }
  })

  test('requires admin_runtime capability for mobile worker stop control', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Stop')
      const worker = server.store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })

      const readOnlyPair = await fetch(`${server.baseUrl}/api/mobile/pair/generate`, {
        headers: jsonHeaders({ cookie }),
        method: 'POST',
        body: JSON.stringify({ capabilities: ['read_dashboard'], device_name: 'Reader' }),
      })
      const { code: readCode } = (await readOnlyPair.json()) as { code: string }
      const readRedeemed = await fetch(`${server.baseUrl}/api/mobile/pair/redeem`, {
        headers: jsonHeaders(),
        method: 'POST',
        body: JSON.stringify({ code: readCode }),
      })
      const reader = (await readRedeemed.json()) as { token: string }

      const forbidden = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/workers/${worker.id}/stop`,
        {
          headers: mobileHeaders(reader.token, '192.168.1.44:4010'),
          method: 'POST',
        }
      )
      expect(forbidden.status).toBe(403)

      const admin = await pairMobile(server.baseUrl)
      const stopped = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/workers/${worker.id}/stop`,
        {
          headers: mobileHeaders(admin.token, '192.168.1.44:4010'),
          method: 'POST',
        }
      )
      const body = (await stopped.json()) as {
        ok: boolean
        status: string
        worker_id: string
        workspace_id: string
      }

      expect(stopped.status).toBe(200)
      expect(body).toEqual({
        ok: true,
        status: 'stopped',
        worker_id: worker.id,
        workspace_id: workspace.id,
      })
    } finally {
      await server.close()
    }
  })
})
