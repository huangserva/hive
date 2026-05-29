import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

const createWorkspaceFixture = (options: { withQuestion?: boolean } = {}) => {
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
  if (options.withQuestion) {
    writeFileSync(
      join(workspacePath, '.hive', 'open-questions.md'),
      `# Open Questions

### 🔴 high — 阻塞当前执行

- [ ] **Q1** Should mobile answer this question?

### 🟠 medium — 影响下一步规划

（暂无）

### 🟢 low — 可稍后处理

（暂无）

## 已答（archive 留追溯）

（暂无）
`,
      'utf8'
    )
  }
  return workspacePath
}

const ALL_MOBILE_CAPABILITIES = [
  'read_dashboard',
  'read_terminal',
  'send_prompt',
  'approve_risk',
  'admin_runtime',
] as const

const createMobileTokenForTest = async (
  baseUrl: string,
  capabilities: string[] = [...ALL_MOBILE_CAPABILITIES],
  name = 'Mobile test device'
) => {
  const cookie = await getUiCookie(baseUrl)
  const response = await fetch(`${baseUrl}/api/mobile/tokens`, {
    body: JSON.stringify({ capabilities, name }),
    headers: { 'content-type': 'application/json', cookie },
    method: 'POST',
  })
  const body = (await response.json()) as { device_id: string; token: string }
  expect(response.status).toBe(200)
  expect(body.device_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  )
  expect(body.token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
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
  test('creates permanent mobile tokens through the token management endpoint', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-mobile-data-'))
    tempDirs.push(dataDir)
    const server = await startTestServer({ dataDir })
    const first = await createMobileTokenForTest(server.baseUrl)
    await server.close()

    const restarted = await startTestServer({ dataDir })
    try {
      const workspaces = await fetch(`${restarted.baseUrl}/api/mobile/workspaces`, {
        headers: mobileHeaders(first.token, '192.168.1.44:4010'),
      })
      expect(workspaces.status).toBe(200)

      const second = await createMobileTokenForTest(restarted.baseUrl)
      expect(second.token).not.toBe(first.token)
    } finally {
      await restarted.close()
    }
  })

  test('requires bearer auth for mobile routes and allows authenticated LAN Host headers', async () => {
    const server = await startTestServer()
    try {
      const { token } = await createMobileTokenForTest(server.baseUrl)

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

  test('registers Expo push token for an authenticated mobile device', async () => {
    const server = await startTestServer()
    try {
      const { token } = await createMobileTokenForTest(server.baseUrl)

      const missing = await fetch(`${server.baseUrl}/api/mobile/push-token`, {
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({ push_token: 'ExponentPushToken[missing]' }),
      })
      expect(missing.status).toBe(401)

      const registered = await fetch(`${server.baseUrl}/api/mobile/push-token`, {
        headers: jsonHeaders({ host: '192.168.1.44:4010', token }),
        method: 'POST',
        body: JSON.stringify({ push_token: 'ExponentPushToken[phone]' }),
      })
      expect(registered.status).toBe(200)
      expect(await registered.json()).toEqual({ ok: true })

      expect(server.store.listMobileDevices()[0]?.push_token).toBe('ExponentPushToken[phone]')
    } finally {
      await server.close()
    }
  })

  test('creates lists edits and hard deletes permanent mobile tokens', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Token Test')
      const cookie = await getUiCookie(server.baseUrl)

      const created = await fetch(`${server.baseUrl}/api/mobile/tokens`, {
        body: JSON.stringify({
          capabilities: ['read_dashboard'],
          name: 'Admin phone',
        }),
        headers: jsonHeaders({ cookie }),
        method: 'POST',
      })
      expect(created.status).toBe(200)
      const createdBody = (await created.json()) as { device_id: string; token: string }
      expect(createdBody.device_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
      expect(createdBody.token).toMatch(/^[A-Za-z0-9_-]{32,}$/)

      const dashboard = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/dashboard`,
        { headers: mobileHeaders(createdBody.token, '192.168.1.44:4010') }
      )
      expect(dashboard.status).toBe(200)

      const list = await fetch(`${server.baseUrl}/api/mobile/tokens`, {
        headers: { cookie },
      })
      expect(list.status).toBe(200)
      const listBody = (await list.json()) as {
        tokens: Array<{
          active: boolean
          capabilities: string[]
          id: string
          name: string
          source: string
          token?: string
        }>
      }
      expect(listBody.tokens).toContainEqual(
        expect.objectContaining({
          active: true,
          capabilities: ['read_dashboard'],
          id: createdBody.device_id,
          name: 'Admin phone',
          source: 'manual',
        })
      )
      expect(listBody.tokens.find((token) => token.id === createdBody.device_id)?.token).toBe(
        undefined
      )

      const updated = await fetch(`${server.baseUrl}/api/mobile/tokens/${createdBody.device_id}`, {
        body: JSON.stringify({ capabilities: ['read_dashboard', 'send_prompt'], name: 'Renamed' }),
        headers: jsonHeaders({ cookie }),
        method: 'PATCH',
      })
      expect(updated.status).toBe(200)
      await expect(updated.json()).resolves.toMatchObject({
        token: expect.objectContaining({
          capabilities: ['read_dashboard', 'send_prompt'],
          id: createdBody.device_id,
          name: 'Renamed',
        }),
      })

      const deleted = await fetch(`${server.baseUrl}/api/mobile/tokens/${createdBody.device_id}`, {
        headers: { cookie },
        method: 'DELETE',
      })
      expect(deleted.status).toBe(200)
      await expect(deleted.json()).resolves.toEqual({ device_id: createdBody.device_id, ok: true })

      const afterDelete = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/dashboard`,
        { headers: mobileHeaders(createdBody.token, '192.168.1.44:4010') }
      )
      expect(afterDelete.status).toBe(401)
    } finally {
      await server.close()
    }
  })

  test('returns a compact dashboard aggregate for a paired mobile client', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Test')
      const worker = server.store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
      server.store.configureAgentLaunch(workspace.id, worker.id, {
        args: [],
        command: 'claude',
        commandPresetId: 'claude',
      })
      const { token } = await createMobileTokenForTest(server.baseUrl)

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
          capabilities: {
            features: string[]
            provider_family: string
            risk_tier: string
          } | null
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
        capabilities: {
          features: expect.arrayContaining(['session_resume', 'session_capture']),
          provider_family: 'claude',
          risk_tier: 'high',
        },
        name: 'Alice',
        preset: 'claude',
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

  test('returns full cockpit data for a paired mobile client', async () => {
    const workspacePath = createWorkspaceFixture({ withQuestion: true })
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Cockpit')
      const { token } = await createMobileTokenForTest(server.baseUrl)

      const response = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/cockpit`,
        { headers: mobileHeaders(token, '192.168.1.44:4010') }
      )
      const body = (await response.json()) as {
        aiActions: unknown[]
        ideas: unknown
        plan: { currentPhase: string | null }
        questions: { high: Array<{ id: string; text: string }> }
        tasks: { totalDone: number; totalOpen: number }
      }

      expect(response.status).toBe(200)
      expect(body.plan.currentPhase).toBe('m19a-lan-dashboard')
      expect(body.tasks).toEqual(expect.objectContaining({ totalDone: 1, totalOpen: 1 }))
      expect(body.questions.high).toContainEqual(
        expect.objectContaining({
          id: 'Q1',
          text: 'Should mobile answer this question?',
        })
      )
      expect(body.ideas).toEqual(expect.any(Object))
      expect(body.aiActions).toEqual(expect.any(Array))
    } finally {
      await server.close()
    }
  })

  test('answers cockpit questions with send_prompt mobile capability', async () => {
    const workspacePath = createWorkspaceFixture({ withQuestion: true })
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Questions')
      const reader = await createMobileTokenForTest(server.baseUrl, ['read_dashboard'], 'Reader')

      const forbidden = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/cockpit/questions/Q1/answer`,
        {
          headers: jsonHeaders({ host: '192.168.1.44:4010', token: reader.token }),
          method: 'POST',
          body: JSON.stringify({ answer: 'Read-only devices cannot answer.' }),
        }
      )
      expect(forbidden.status).toBe(403)

      const sender = await createMobileTokenForTest(server.baseUrl, ['send_prompt'], 'Sender')

      const answered = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/cockpit/questions/Q1/answer`,
        {
          headers: jsonHeaders({ host: '192.168.1.44:4010', token: sender.token }),
          method: 'POST',
          body: JSON.stringify({ answer: 'Yes, ship mobile cockpit.' }),
        }
      )

      expect(answered.status).toBe(200)
      expect(await answered.json()).toEqual({ ok: true })
      const questionsFile = readFileSync(join(workspacePath, '.hive', 'open-questions.md'), 'utf8')
      expect(questionsFile).toContain('**Q1** Should mobile answer this question?')
      expect(questionsFile).toContain('Yes, ship mobile cockpit.')
      expect(questionsFile).toContain('**answered')
    } finally {
      await server.close()
    }
  })

  test('serves cockpit doc files inside .hive to paired mobile clients', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Docs')
      mkdirSync(join(workspacePath, '.hive', 'reports'), { recursive: true })
      writeFileSync(join(workspacePath, '.hive', 'notes.md'), '# Mobile Note\n', 'utf8')
      writeFileSync(
        join(workspacePath, '.hive', 'reports', 'mobile.html'),
        '<!doctype html><h1>Mobile Report</h1>',
        'utf8'
      )
      const { token } = await createMobileTokenForTest(server.baseUrl)

      const markdown = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/cockpit/doc-file?path=${encodeURIComponent(
          '.hive/notes.md'
        )}`,
        { headers: mobileHeaders(token, '192.168.1.44:4010') }
      )
      expect(markdown.status).toBe(200)
      expect(markdown.headers.get('content-type')).toContain('text/plain')
      expect(await markdown.text()).toContain('# Mobile Note')

      const html = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/cockpit/doc-file?path=${encodeURIComponent(
          '.hive/reports/mobile.html'
        )}`,
        { headers: mobileHeaders(token, '192.168.1.44:4010') }
      )
      expect(html.status).toBe(200)
      expect(html.headers.get('content-type')).toContain('text/html')
      expect(await html.text()).toContain('Mobile Report')

      const traversal = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/cockpit/doc-file?path=${encodeURIComponent(
          '.hive/../package.json'
        )}`,
        { headers: mobileHeaders(token, '192.168.1.44:4010') }
      )
      expect(traversal.status).toBe(400)
    } finally {
      await server.close()
    }
  })

  test('streams mobile dashboard snapshots over websocket with query token auth', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile WS')
      const { token } = await createMobileTokenForTest(server.baseUrl)

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

  test('returns persisted mobile chat messages for a paired mobile client', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Chat')
      const first = server.store.insertMobileChatMessage(
        workspace.id,
        'inbound',
        'user_text',
        JSON.stringify({ text: 'hello from phone' })
      )
      await new Promise((resolve) => setTimeout(resolve, 5))
      const second = server.store.insertMobileChatMessage(
        workspace.id,
        'outbound',
        'system_event',
        JSON.stringify({ event: 'dispatch', task_summary: 'wire chat stream', worker: 'Alice' })
      )
      const { token } = await createMobileTokenForTest(server.baseUrl)

      const response = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/chat/messages?since=${first.created_at}&limit=10`,
        { headers: mobileHeaders(token, '192.168.1.44:4010') }
      )
      const body = (await response.json()) as {
        messages: Array<{
          content_json: string
          created_at: number
          direction: string
          id: string
          message_type: string
          workspace_id: string
        }>
      }

      expect(response.status).toBe(200)
      expect(body.messages).toEqual([
        {
          content_json: second.content_json,
          created_at: second.created_at,
          direction: 'outbound',
          id: second.id,
          message_type: 'system_event',
          workspace_id: workspace.id,
        },
      ])
    } finally {
      await server.close()
    }
  })

  test('broadcasts mobile chat messages over the dashboard websocket', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Chat WS')
      const { token } = await createMobileTokenForTest(server.baseUrl)
      const socket = new WebSocket(
        toWsUrl(server.baseUrl, `/ws/mobile/workspaces/${workspace.id}/dashboard?token=${token}`),
        { headers: { host: '192.168.1.44:4010' } }
      )
      await waitForMessage(socket)

      const message = server.store.insertMobileChatMessage(
        workspace.id,
        'outbound',
        'worker_report',
        JSON.stringify({ summary: 'done', worker_name: 'Alice' })
      )
      const frame = await waitForMessage<{
        kind: string
        payload: { id: string; message_type: string; workspace_id: string }
      }>(socket)

      expect(frame).toEqual({
        kind: 'mobile-chat-message',
        payload: expect.objectContaining({
          id: message.id,
          message_type: 'worker_report',
          workspace_id: workspace.id,
        }),
      })
      socket.close()
    } finally {
      await server.close()
    }
  })

  test('records orchestrator replies through the explicit team mobile-reply route', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Reply')
      const orchestratorId = `${workspace.id}:orchestrator`
      const orchScript = join(workspacePath, 'orch-mobile-reply-idle.js')
      writeFileSync(orchScript, 'process.stdin.resume()\n', 'utf8')
      server.store.configureAgentLaunch(workspace.id, orchestratorId, {
        args: ['-lc', `"${process.execPath}" "${orchScript}"`],
        command: '/bin/bash',
      })
      await server.store.startAgent(workspace.id, orchestratorId, {
        hivePort: '4010',
      })
      const orchestratorToken = server.store.peekAgentToken(orchestratorId)
      if (!orchestratorToken) throw new Error('Expected orchestrator token')

      const response = await fetch(`${server.baseUrl}/api/team/mobile-reply`, {
        headers: jsonHeaders(),
        method: 'POST',
        body: JSON.stringify({
          from_agent_id: orchestratorId,
          project_id: workspace.id,
          text: 'I received the mobile request and will inspect the sprint.',
          token: orchestratorToken,
        }),
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true })

      const messages = server.store.listMobileChatMessages(workspace.id)
      const reply = messages.find((message) => message.message_type === 'orch_reply')
      expect(reply).toMatchObject({
        direction: 'outbound',
        message_type: 'orch_reply',
        workspace_id: workspace.id,
      })
      expect(JSON.parse(reply?.content_json ?? '{}')).toEqual({
        text: 'I received the mobile request and will inspect the sprint.',
      })
    } finally {
      await server.close()
    }
  })

  test('requires mobile read_dashboard capability before serving uploaded files', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Uploads')
      const sender = await createMobileTokenForTest(server.baseUrl, ['send_prompt'], 'Sender')
      const upload = await fetch(`${server.baseUrl}/api/mobile/workspaces/${workspace.id}/upload`, {
        body: JSON.stringify({
          data: Buffer.from('private upload bytes').toString('base64'),
          filename: 'private.txt',
          mime_type: 'text/plain',
        }),
        headers: jsonHeaders({ host: '192.168.1.44:4010', token: sender.token }),
        method: 'POST',
      })
      const uploaded = (await upload.json()) as { url: string }
      expect(upload.status).toBe(200)
      expect(uploaded.url).toMatch(/^\/api\/mobile\/uploads\//)

      const anonymous = await fetch(`${server.baseUrl}${uploaded.url}`, {
        headers: { host: '192.168.1.44:4010' },
      })
      expect(anonymous.status).toBe(401)

      const noReader = await fetch(`${server.baseUrl}${uploaded.url}`, {
        headers: mobileHeaders(sender.token, '192.168.1.44:4010'),
      })
      expect(noReader.status).toBe(403)

      const reader = await createMobileTokenForTest(server.baseUrl, ['read_dashboard'], 'Reader')
      const allowed = await fetch(`${server.baseUrl}${uploaded.url}`, {
        headers: mobileHeaders(reader.token, '192.168.1.44:4010'),
      })
      expect(allowed.status).toBe(200)
      expect(await allowed.text()).toBe('private upload bytes')
    } finally {
      await server.close()
    }
  })

  test('keeps pending mobile uploads isolated per device before prompt submission', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Upload Isolation')
      const orchestratorId = `${workspace.id}:orchestrator`
      const orchScript = join(workspacePath, 'orch-upload-echo.js')
      writeFileSync(
        orchScript,
        [
          "process.stdin.setEncoding('utf8')",
          "process.stdin.on('data', (chunk) => process.stdout.write('ORCH:' + chunk))",
        ].join('\n'),
        'utf8'
      )
      server.store.configureAgentLaunch(workspace.id, orchestratorId, {
        args: ['-lc', `"${process.execPath}" "${orchScript}"`],
        command: '/bin/bash',
      })
      await server.store.startAgent(workspace.id, orchestratorId, {
        hivePort: '4010',
      })

      const firstDevice = await createMobileTokenForTest(server.baseUrl, ['send_prompt'], 'Phone A')
      const secondDevice = await createMobileTokenForTest(
        server.baseUrl,
        ['send_prompt'],
        'Phone B'
      )

      const firstUpload = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/upload`,
        {
          body: JSON.stringify({
            data: Buffer.from('image from phone a').toString('base64'),
            filename: 'phone-a.png',
            mime_type: 'image/png',
          }),
          headers: jsonHeaders({ host: '192.168.1.44:4010', token: firstDevice.token }),
          method: 'POST',
        }
      )
      const firstBody = (await firstUpload.json()) as { file_id: string }
      expect(firstUpload.status).toBe(200)

      const secondUpload = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/upload`,
        {
          body: JSON.stringify({
            data: Buffer.from('image from phone b').toString('base64'),
            filename: 'phone-b.png',
            mime_type: 'image/png',
          }),
          headers: jsonHeaders({ host: '192.168.1.44:4010', token: secondDevice.token }),
          method: 'POST',
        }
      )
      const secondBody = (await secondUpload.json()) as { file_id: string }
      expect(secondUpload.status).toBe(200)

      const secondPrompt = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/prompt`,
        {
          body: JSON.stringify({ text: 'Prompt from phone B' }),
          headers: jsonHeaders({ host: '192.168.1.44:4010', token: secondDevice.token }),
          method: 'POST',
        }
      )
      expect(secondPrompt.status).toBe(200)

      const firstPrompt = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/prompt`,
        {
          body: JSON.stringify({ text: 'Prompt from phone A' }),
          headers: jsonHeaders({ host: '192.168.1.44:4010', token: firstDevice.token }),
          method: 'POST',
        }
      )
      expect(firstPrompt.status).toBe(200)

      const recoveryMessages = server.store.listMessagesForRecovery(workspace.id, 0)
      const messageFromB = recoveryMessages.find((message) =>
        message.text.includes('Prompt from phone B')
      )
      const messageFromA = recoveryMessages.find((message) =>
        message.text.includes('Prompt from phone A')
      )

      expect(messageFromB?.text).toContain(secondBody.file_id)
      expect(messageFromB?.text).not.toContain(firstBody.file_id)
      expect(messageFromA?.text).toContain(firstBody.file_id)
      expect(messageFromA?.text).not.toContain(secondBody.file_id)
    } finally {
      await server.close()
    }
  })

  test('does not expose deprecated pairing code endpoints', async () => {
    const server = await startTestServer()
    try {
      const pair = await fetch(`${server.baseUrl}/api/mobile/pair`)
      expect(pair.status).toBe(404)

      const generate = await fetch(`${server.baseUrl}/api/mobile/pair/generate`, {
        headers: jsonHeaders(),
        method: 'POST',
        body: JSON.stringify({ capabilities: ['read_dashboard'], device_name: 'Phone' }),
      })
      expect(generate.status).toBe(404)

      const redeem = await fetch(`${server.baseUrl}/api/mobile/pair/redeem`, {
        headers: jsonHeaders(),
        method: 'POST',
        body: JSON.stringify({ code: '123456' }),
      })
      expect(redeem.status).toBe(404)
    } finally {
      await server.close()
    }
  })

  test('gates mobile device registry by admin_runtime capability and revokes tokens', async () => {
    const server = await startTestServer()
    try {
      const admin = await createMobileTokenForTest(server.baseUrl)
      const reader = await createMobileTokenForTest(server.baseUrl, ['read_dashboard'], 'Reader')

      const forbidden = await fetch(`${server.baseUrl}/api/mobile/devices`, {
        headers: mobileHeaders(reader.token, '192.168.1.44:4010'),
      })
      expect(forbidden.status).toBe(403)

      const patched = await fetch(`${server.baseUrl}/api/mobile/devices/${reader.device_id}`, {
        headers: jsonHeaders({ host: '192.168.1.44:4010', token: admin.token }),
        method: 'PATCH',
        body: JSON.stringify({ capabilities: ['read_dashboard', 'send_prompt'], name: 'Reader 2' }),
      })
      expect(patched.status).toBe(200)

      const revoked = await fetch(`${server.baseUrl}/api/mobile/devices/${reader.device_id}`, {
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
      const mobile = await createMobileTokenForTest(server.baseUrl)

      const listed = await fetch(`${server.baseUrl}/api/mobile/devices`, {
        headers: jsonHeaders({ cookie }),
      })
      const listedBody = (await listed.json()) as { devices: Array<{ id: string; name: string }> }
      expect(listed.status).toBe(200)
      expect(listedBody.devices).toContainEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: 'Mobile test device',
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
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Control')
      const worker = server.store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
      const reader = await createMobileTokenForTest(server.baseUrl, ['read_dashboard'], 'Reader')

      const forbidden = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/dispatch`,
        {
          headers: jsonHeaders({ host: '192.168.1.44:4010', token: reader.token }),
          method: 'POST',
          body: JSON.stringify({ task: 'Do mobile task', worker_id: worker.id }),
        }
      )
      expect(forbidden.status).toBe(403)

      const sender = await createMobileTokenForTest(server.baseUrl, ['send_prompt'], 'Sender')
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
      expect(server.store.listMobileChatMessages(workspace.id)).toContainEqual(
        expect.objectContaining({
          direction: 'outbound',
          message_type: 'system_event',
          workspace_id: workspace.id,
        })
      )
    } finally {
      await server.close()
    }
  })

  test('records mobile approval decisions with approve_risk capability', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Approval')
      const orchestratorId = `${workspace.id}:orchestrator`
      const orchScript = join(workspacePath, 'orch-approval-echo.js')
      writeFileSync(
        orchScript,
        [
          "process.stdin.setEncoding('utf8')",
          "process.stdin.on('data', (chunk) => process.stdout.write('ORCH:' + chunk))",
        ].join('\n'),
        'utf8'
      )
      server.store.configureAgentLaunch(workspace.id, orchestratorId, {
        args: ['-lc', `"${process.execPath}" "${orchScript}"`],
        command: '/bin/bash',
      })
      const run = await server.store.startAgent(workspace.id, orchestratorId, {
        hivePort: '4010',
      })
      const approval = server.store.approvalLedger.create({
        action: 'Remove generated files',
        chatId: 'oc_mobile',
        messageId: 'om_mobile',
        orchAgentId: orchestratorId,
        risk: 'high',
        target: null,
        workspaceId: workspace.id,
      })

      const reader = await createMobileTokenForTest(server.baseUrl, ['read_dashboard'], 'Reader')

      const forbidden = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/approve/${approval.approvalId}`,
        {
          headers: jsonHeaders({ host: '192.168.1.44:4010', token: reader.token }),
          method: 'POST',
          body: JSON.stringify({ decision: 'allow' }),
        }
      )
      expect(forbidden.status).toBe(403)

      const approver = await createMobileTokenForTest(server.baseUrl, ['approve_risk'], 'Approver')

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
      await waitFor(() => {
        const activeRun = server.store.getLiveRun(run.runId)
        expect(activeRun.output).toContain(`approval_id=${approval.approvalId} ALLOWED`)
        expect(activeRun.output).toContain('action: Remove generated files')
      })
      expect(server.store.listMessagesForRecovery(workspace.id, 0)).toContainEqual(
        expect.objectContaining({
          text: expect.stringContaining(`approval_id=${approval.approvalId} ALLOWED`),
          type: 'user_input',
        })
      )
    } finally {
      await server.close()
    }
  })

  test('requires admin_runtime capability for mobile worker stop control', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Stop')
      const worker = server.store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
      const reader = await createMobileTokenForTest(server.baseUrl, ['read_dashboard'], 'Reader')

      const forbidden = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/workers/${worker.id}/stop`,
        {
          headers: mobileHeaders(reader.token, '192.168.1.44:4010'),
          method: 'POST',
        }
      )
      expect(forbidden.status).toBe(403)

      const admin = await createMobileTokenForTest(server.baseUrl)
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

  test('returns a stripped worker transcript for a paired mobile client', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Transcript')
      const worker = server.store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
      server.store.configureAgentLaunch(workspace.id, worker.id, {
        command: process.execPath,
        args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'],
      })
      const run = await server.store.startAgent(workspace.id, worker.id, { hivePort: '4010' })
      const output = Array.from(
        { length: 105 },
        (_item, index) => `\u001b[31mline-${String(index + 1).padStart(3, '0')}\u001b[0m\n`
      ).join('')
      server.store.getPtyOutputBus().publish(run.runId, output)
      await new Promise((resolve) => setTimeout(resolve, 20))

      const { token } = await createMobileTokenForTest(server.baseUrl)
      const response = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/workers/${worker.id}/transcript`,
        { headers: mobileHeaders(token, '192.168.1.44:4010') }
      )
      const body = (await response.json()) as {
        lines: string[]
        status: string
        truncated: boolean
        worker_id: string
        worker_name: string
      }

      expect(response.status).toBe(200)
      expect(body.worker_id).toBe(worker.id)
      expect(body.worker_name).toBe('Alice')
      expect(body.status).toBe('idle')
      expect(body.truncated).toBe(true)
      expect(body.lines).toHaveLength(100)
      expect(body.lines[0]).toBe('line-006')
      expect(body.lines.at(-1)).toBe('line-105')
      expect(body.lines.join('\n')).not.toContain('\u001b[')
    } finally {
      await server.close()
    }
  }, 15000)

  test('returns orchestrator transcript for a paired mobile client', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(
        workspacePath,
        'Mobile Orchestrator Transcript'
      )
      const orchestratorId = `${workspace.id}:orchestrator`
      server.store.configureAgentLaunch(workspace.id, orchestratorId, {
        command: process.execPath,
        args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'],
      })
      const run = await server.store.startAgent(workspace.id, orchestratorId, { hivePort: '4010' })
      server.store
        .getPtyOutputBus()
        .publish(run.runId, '\u001b[32morchestrator ready\u001b[0m\nplanning next step\n')
      await new Promise((resolve) => setTimeout(resolve, 20))

      const { token } = await createMobileTokenForTest(server.baseUrl)
      const response = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/workers/${encodeURIComponent(orchestratorId)}/transcript`,
        { headers: mobileHeaders(token, '192.168.1.44:4010') }
      )
      const body = (await response.json()) as {
        lines: string[]
        status: string
        truncated: boolean
        worker_id: string
        worker_name: string
      }

      expect(response.status).toBe(200)
      expect(body).toEqual({
        lines: ['orchestrator ready', 'planning next step'],
        status: 'idle',
        truncated: false,
        worker_id: orchestratorId,
        worker_name: 'Orchestrator',
      })
    } finally {
      await server.close()
    }
  }, 15000)

  test('returns mobile dispatch task history with compact summaries', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Tasks')
      const worker = server.store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
      const pending = await server.store.dispatchTask(
        workspace.id,
        worker.id,
        'Investigate the mobile task list endpoint and keep the summary compact enough for a phone screen'
      )
      const done = await server.store.dispatchTask(workspace.id, worker.id, 'Report completed work')
      server.store.reportTask(workspace.id, worker.id, {
        dispatchId: done.id,
        reportText: 'done',
      })
      expect(server.store.listMobileChatMessages(workspace.id)).toContainEqual(
        expect.objectContaining({
          direction: 'outbound',
          message_type: 'worker_report',
          workspace_id: workspace.id,
        })
      )
      const cancelled = await server.store.dispatchTask(workspace.id, worker.id, 'Cancel me')
      server.store.cancelTask(workspace.id, cancelled.id, {
        fromAgentId: worker.id,
        reason: 'not needed',
      })

      const { token } = await createMobileTokenForTest(server.baseUrl)
      const response = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/tasks`,
        {
          headers: mobileHeaders(token, '192.168.1.44:4010'),
        }
      )
      const body = (await response.json()) as {
        dispatches: Array<{
          created_at: string
          id: string
          status: string
          task_summary: string
          worker_name: string
        }>
        workspace_id: string
      }

      expect(response.status).toBe(200)
      expect(body.workspace_id).toBe(workspace.id)
      expect(body.dispatches.map((dispatch) => dispatch.id)).toEqual([
        pending.id,
        done.id,
        cancelled.id,
      ])
      expect(body.dispatches.map((dispatch) => dispatch.status)).toEqual([
        'pending',
        'done',
        'cancelled',
      ])
      expect(body.dispatches[0].worker_name).toBe('Alice')
      expect(body.dispatches[0].task_summary.length).toBeLessThanOrEqual(80)
      expect(new Date(body.dispatches[0].created_at).toString()).not.toBe('Invalid Date')
    } finally {
      await server.close()
    }
  })
})
