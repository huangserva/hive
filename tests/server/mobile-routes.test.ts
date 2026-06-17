import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'
import WebSocket from 'ws'

import { runTeamCommand } from '../../src/cli/team.js'
import { resetMobileReplyObligationsForTests } from '../../src/server/mobile-reply-obligation.js'
import { buildMobileWorkerTranscript } from '../../src/server/routes-mobile.js'
import { createWebRtcFileDownlinkAudio } from '../../src/server/webrtc-file-downlink-audio.js'
import {
  claimOldestPendingWebRtcVoiceHandoffTurn,
  markWebRtcVoiceLatency,
  resetWebRtcVoiceLatencyForTests,
  startWebRtcVoiceLatencyTurn,
} from '../../src/server/webrtc-voice-latency.js'
import { startTestServer } from '../helpers/test-server.js'
import { getUiCookie } from '../helpers/ui-session.js'

const tempDirs: string[] = []
const originalPath = process.env.PATH

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  resetMobileReplyObligationsForTests()
  resetWebRtcVoiceLatencyForTests()
  process.env.PATH = originalPath
  delete process.env.HIVE_EDGE_TTS_ARGS_PATH
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

const withMockedGlmFastReply = async <T>(reply: string, run: () => Promise<T>): Promise<T> => {
  vi.stubEnv('GLM_API_KEY', 'test-glm-key')
  const originalFetch = globalThis.fetch
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/chat/completions')) {
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      )
    }
    return originalFetch(input, init)
  })
  vi.stubGlobal('fetch', fetchMock)
  try {
    return await run()
  } finally {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  }
}

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

  test('sanitizes LAN voice synthesis text before invoking local TTS', async () => {
    const binDir = mkdtempSync(join(tmpdir(), 'hive-mobile-tts-bin-'))
    const argsPath = join(binDir, 'edge-tts-args.json')
    tempDirs.push(binDir)
    const edgeTtsPath = join(binDir, 'edge-tts')
    writeFileSync(
      edgeTtsPath,
      `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.writeFileSync(process.env.HIVE_EDGE_TTS_ARGS_PATH, JSON.stringify(args), 'utf8')
const outputPath = args[args.indexOf('--write-media') + 1]
fs.writeFileSync(outputPath, 'audio')
`,
      'utf8'
    )
    chmodSync(edgeTtsPath, 0o755)
    process.env.HIVE_EDGE_TTS_ARGS_PATH = argsPath
    process.env.PATH = `${binDir}${delimiter}${originalPath ?? ''}`
    const server = await startTestServer()
    try {
      const { token } = await createMobileTokenForTest(server.baseUrl)
      const text =
        '✅ 下载 https://example.com/builds/app-release-2.7.4-a1b2c3d4.apk commit `5aea765`'

      const response = await fetch(`${server.baseUrl}/api/mobile/voice/synthesize`, {
        body: JSON.stringify({ text, voice: 'zh-CN-XiaoxiaoNeural' }),
        headers: jsonHeaders({ token }),
        method: 'POST',
      })

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        audio: Buffer.from('audio').toString('base64'),
        format: 'mp3',
        mime: 'audio/mpeg',
      })
      const args = JSON.parse(readFileSync(argsPath, 'utf8')) as string[]
      expect(args[args.indexOf('--text') + 1]).toBe('完成 下载 链接 commit 一个版本')
      expect(text).toContain('https://example.com/builds')
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

  test('dashboard exposes stale/escalated dispatch counts (worker done-but-not-reported surface)', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Stale')
      const { token } = await createMobileTokenForTest(server.baseUrl)
      const response = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/dashboard`,
        { headers: mobileHeaders(token, '192.168.1.44:4010') }
      )
      const body = (await response.json()) as {
        cockpit: { escalated_dispatches: number; stale_dispatches: number }
      }

      expect(response.status).toBe(200)
      // Fields are wired and numeric (no stale dispatches in a fresh workspace).
      expect(body.cockpit.stale_dispatches).toBe(0)
      expect(body.cockpit.escalated_dispatches).toBe(0)
    } finally {
      await server.close()
    }
  })

  test('cockpit exposes baseline and decisions for mobile (parity with web)', async () => {
    const workspacePath = createWorkspaceFixture()
    mkdirSync(join(workspacePath, '.hive', 'baseline'), { recursive: true })
    writeFileSync(
      join(workspacePath, '.hive', 'baseline', 'README.md'),
      '# Baseline 索引\n\n稳定上下文。\n',
      'utf8'
    )
    mkdirSync(join(workspacePath, '.hive', 'decisions'), { recursive: true })
    writeFileSync(
      join(workspacePath, '.hive', 'decisions', 'draft-2026-05-31-mobile-parity.md'),
      '# 手机端追平 Web\n\n**状态**: 提案中\n\n决策草稿正文。\n',
      'utf8'
    )
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Parity')
      const { token } = await createMobileTokenForTest(server.baseUrl)

      const response = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/cockpit`,
        { headers: mobileHeaders(token, '192.168.1.44:4010') }
      )
      const body = (await response.json()) as {
        archive: unknown
        baseline: { readme: { title: string } | null }
        decisions: { drafts: Array<{ slug: string; status: string; title: string }> }
        reports: unknown
        research: unknown
      }

      expect(response.status).toBe(200)
      expect(body.baseline.readme?.title).toBe('Baseline 索引')
      expect(body.decisions.drafts).toContainEqual(
        expect.objectContaining({ slug: 'mobile-parity', status: 'draft', title: '手机端追平 Web' })
      )
      // Index docs are exposed too so the phone can build the remaining tabs.
      expect(body.reports).toEqual(expect.any(Object))
      expect(body.research).toEqual(expect.any(Object))
      expect(body.archive).toEqual(expect.any(Object))
    } finally {
      await server.close()
    }
  })

  test('dashboard runs carry a real started_at timestamp (not hardcoded null)', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Uptime')
      const orchestratorId = `${workspace.id}:orchestrator`
      server.store.configureAgentLaunch(workspace.id, orchestratorId, {
        args: ['-c', 'exec cat'],
        command: '/bin/bash',
      })
      const before = Date.now()
      await server.store.startAgent(workspace.id, orchestratorId, { hivePort: '4010' })
      const { token } = await createMobileTokenForTest(server.baseUrl)

      const response = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/dashboard`,
        { headers: mobileHeaders(token, '192.168.1.44:4010') }
      )
      const body = (await response.json()) as {
        runs: Array<{ agent_name: string; id: string; started_at: string | null; status: string }>
      }

      expect(response.status).toBe(200)
      expect(body.runs.length).toBeGreaterThanOrEqual(1)
      const startedAt = body.runs[0]?.started_at
      expect(startedAt).not.toBeNull()
      const parsed = new Date(startedAt as string).getTime()
      expect(Number.isNaN(parsed)).toBe(false)
      // Real launch time, not 0/epoch — would fail if started_at were faked.
      expect(parsed).toBeGreaterThanOrEqual(before - 1000)
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
    const infoLogs: string[] = []
    const server = await startTestServer({
      logger: {
        async close() {},
        error: () => {},
        info: (message) => infoLogs.push(message),
        warn: () => {},
      },
    })
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
      expect(infoLogs).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            `team mobile reply inserted: workspace_id=${workspace.id} from_agent_id=${orchestratorId}`
          ),
          expect.stringContaining('active_webrtc_calls=0 voice_latency_turn_id=none'),
        ])
      )
    } finally {
      await server.close()
    }
  })

  test('does not log an explicit mobile reply for ordinary orchestrator stdout', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    vi.stubEnv('HIVE_MOBILE_REPLY_WATCHDOG_MS', '80')
    const workspacePath = createWorkspaceFixture()
    const infoLogs: string[] = []
    const warnLogs: string[] = []
    const server = await startTestServer({
      logger: {
        async close() {},
        error: () => {},
        info: (message) => infoLogs.push(message),
        warn: (message) => warnLogs.push(message),
      },
    })
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Reply Stdout')
      const sender = await createMobileTokenForTest(server.baseUrl, ['send_prompt'], 'Sender')
      const orchestratorId = `${workspace.id}:orchestrator`
      const orchScript = join(workspacePath, 'orch-mobile-reply-stdout.js')
      writeFileSync(
        orchScript,
        "process.stdin.on('data', () => { console.log('普通 PM stdout，不是 team mobile-reply') })\nprocess.stdin.resume()\n",
        'utf8'
      )
      server.store.configureAgentLaunch(workspace.id, orchestratorId, {
        args: ['-lc', `"${process.execPath}" "${orchScript}"`],
        command: '/bin/bash',
      })
      await server.store.startAgent(workspace.id, orchestratorId, {
        hivePort: '4010',
      })

      const response = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/prompt`,
        {
          body: JSON.stringify({ text: '请普通回复一下' }),
          headers: mobileHeaders(sender.token, '192.168.1.44:4010'),
          method: 'POST',
        }
      )
      expect(response.status).toBe(200)
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(infoLogs.some((message) => message.includes('team mobile reply inserted'))).toBe(false)
      expect(
        warnLogs.some((message) =>
          message.includes('mobile reply obligation stdout without mobile-reply')
        )
      ).toBe(true)
      expect(warnLogs.some((message) => message.includes('mobile reply obligation stalled'))).toBe(
        true
      )
      expect(
        server.store
          .listMobileChatMessages(workspace.id)
          .some((message) => message.message_type === 'orch_reply')
      ).toBe(false)
      const inbound = server.store
        .listMobileChatMessages(workspace.id)
        .find((message) => message.message_type === 'user_text')
      expect(JSON.parse(inbound?.content_json ?? '{}')).toMatchObject({
        reply_sink: 'mobile',
        source: 'mobile',
        text: '请普通回复一下',
      })
      const systemEvents = server.store
        .listMobileChatMessages(workspace.id)
        .filter((message) => message.message_type === 'system_event')
        .map((message) => JSON.parse(message.content_json) as { event: string; source: string })
      expect(systemEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'mobile_reply_plain_output_without_mobile_reply',
            source: 'mobile',
          }),
          expect.objectContaining({
            event: 'mobile_reply_obligation_stalled',
            source: 'mobile',
          }),
        ])
      )
    } finally {
      await server.close()
    }
  })

  test('clears pending mobile reply obligation when team mobile-reply succeeds', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    vi.stubEnv('HIVE_MOBILE_REPLY_WATCHDOG_MS', '50')
    const workspacePath = createWorkspaceFixture()
    const infoLogs: string[] = []
    const warnLogs: string[] = []
    const server = await startTestServer({
      logger: {
        async close() {},
        error: () => {},
        info: (message) => infoLogs.push(message),
        warn: (message) => warnLogs.push(message),
      },
    })
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Reply Fulfilled')
      const sender = await createMobileTokenForTest(server.baseUrl, ['send_prompt'], 'Sender')
      const orchestratorId = `${workspace.id}:orchestrator`
      const orchScript = join(workspacePath, 'orch-mobile-reply-fulfilled.js')
      writeFileSync(orchScript, 'process.stdin.resume()\n', 'utf8')
      server.store.configureAgentLaunch(workspace.id, orchestratorId, {
        args: ['-lc', `"${process.execPath}" "${orchScript}"`],
        command: '/bin/bash',
      })
      await server.store.startAgent(workspace.id, orchestratorId, {
        hivePort: '4010',
      })

      const prompt = await fetch(`${server.baseUrl}/api/mobile/workspaces/${workspace.id}/prompt`, {
        body: JSON.stringify({ text: 'PM 请回答手机这个问题' }),
        headers: mobileHeaders(sender.token, '192.168.1.44:4010'),
        method: 'POST',
      })
      expect(prompt.status).toBe(200)

      const token = server.store.peekAgentToken(orchestratorId)
      expect(token).toBeTruthy()
      const reply = await fetch(`${server.baseUrl}/api/team/mobile-reply`, {
        body: JSON.stringify({
          from_agent_id: orchestratorId,
          project_id: workspace.id,
          text: '手机侧已经收到 PM 回复。',
          token,
        }),
        headers: jsonHeaders(),
        method: 'POST',
      })
      expect(reply.status).toBe(200)
      await new Promise((resolve) => setTimeout(resolve, 80))

      expect(
        infoLogs.some((message) => message.includes('mobile reply obligation fulfilled'))
      ).toBe(true)
      expect(warnLogs.some((message) => message.includes('mobile reply obligation stalled'))).toBe(
        false
      )
      const messages = server.store.listMobileChatMessages(workspace.id)
      expect(messages.some((message) => message.message_type === 'orch_reply')).toBe(true)
      const obligationEvents = messages
        .filter((message) => message.message_type === 'system_event')
        .map((message) => JSON.parse(message.content_json) as { event?: string })
        .filter((message) => message.event?.startsWith('mobile_reply_'))
      expect(
        obligationEvents.some((message) => message.event === 'mobile_reply_obligation_stalled')
      ).toBe(false)
    } finally {
      await server.close()
    }
  })

  test('uses reply_to_user_message_id so out-of-order mobile replies do not clear the wrong obligation', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    vi.stubEnv('HIVE_MOBILE_REPLY_WATCHDOG_MS', '50')
    const workspacePath = createWorkspaceFixture()
    const infoLogs: string[] = []
    const warnLogs: string[] = []
    const server = await startTestServer({
      logger: {
        async close() {},
        error: () => {},
        info: (message) => infoLogs.push(message),
        warn: (message) => warnLogs.push(message),
      },
    })
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Reply Ordered')
      const sender = await createMobileTokenForTest(server.baseUrl, ['send_prompt'], 'Sender')
      const orchestratorId = `${workspace.id}:orchestrator`
      const orchScript = join(workspacePath, 'orch-mobile-reply-ordered.js')
      writeFileSync(orchScript, 'process.stdin.resume()\n', 'utf8')
      server.store.configureAgentLaunch(workspace.id, orchestratorId, {
        args: ['-lc', `"${process.execPath}" "${orchScript}"`],
        command: '/bin/bash',
      })
      await server.store.startAgent(workspace.id, orchestratorId, {
        hivePort: '4010',
      })

      for (const text of ['第一条手机问题', '第二条手机问题']) {
        const prompt = await fetch(
          `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/prompt`,
          {
            body: JSON.stringify({ text }),
            headers: mobileHeaders(sender.token, '192.168.1.44:4010'),
            method: 'POST',
          }
        )
        expect(prompt.status).toBe(200)
      }
      const inbound = server.store
        .listMobileChatMessages(workspace.id)
        .filter(
          (message) => message.direction === 'inbound' && message.message_type === 'user_text'
        )
      expect(inbound).toHaveLength(2)
      const firstId = inbound[0]?.id
      const secondId = inbound[1]?.id
      if (!firstId || !secondId) throw new Error('Expected two inbound mobile messages')

      const token = server.store.peekAgentToken(orchestratorId)
      expect(token).toBeTruthy()
      const replySecond = await fetch(`${server.baseUrl}/api/team/mobile-reply`, {
        body: JSON.stringify({
          from_agent_id: orchestratorId,
          project_id: workspace.id,
          reply_to_user_message_id: secondId,
          text: '先回答第二条。',
          token,
        }),
        headers: jsonHeaders(),
        method: 'POST',
      })
      expect(replySecond.status).toBe(200)
      await new Promise((resolve) => setTimeout(resolve, 80))

      expect(
        infoLogs.some(
          (message) =>
            message.includes('mobile reply obligation fulfilled') && message.includes(secondId)
        )
      ).toBe(true)
      expect(
        warnLogs.some(
          (message) =>
            message.includes('mobile reply obligation stalled') && message.includes(firstId)
        )
      ).toBe(true)
      expect(
        warnLogs.some(
          (message) =>
            message.includes('mobile reply obligation stalled') && message.includes(secondId)
        )
      ).toBe(false)
    } finally {
      await server.close()
    }
  })

  test('does not clear an ambiguous mobile reply obligation when multiple pending replies lack correlation', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    vi.stubEnv('HIVE_MOBILE_REPLY_WATCHDOG_MS', '50')
    const workspacePath = createWorkspaceFixture()
    const infoLogs: string[] = []
    const warnLogs: string[] = []
    const server = await startTestServer({
      logger: {
        async close() {},
        error: () => {},
        info: (message) => infoLogs.push(message),
        warn: (message) => warnLogs.push(message),
      },
    })
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Reply Ambiguous')
      const sender = await createMobileTokenForTest(server.baseUrl, ['send_prompt'], 'Sender')
      const orchestratorId = `${workspace.id}:orchestrator`
      const orchScript = join(workspacePath, 'orch-mobile-reply-ambiguous.js')
      writeFileSync(orchScript, 'process.stdin.resume()\n', 'utf8')
      server.store.configureAgentLaunch(workspace.id, orchestratorId, {
        args: ['-lc', `"${process.execPath}" "${orchScript}"`],
        command: '/bin/bash',
      })
      await server.store.startAgent(workspace.id, orchestratorId, {
        hivePort: '4010',
      })

      for (const text of ['第一条未关联问题', '第二条未关联问题']) {
        const prompt = await fetch(
          `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/prompt`,
          {
            body: JSON.stringify({ text }),
            headers: mobileHeaders(sender.token, '192.168.1.44:4010'),
            method: 'POST',
          }
        )
        expect(prompt.status).toBe(200)
      }

      const token = server.store.peekAgentToken(orchestratorId)
      expect(token).toBeTruthy()
      const reply = await fetch(`${server.baseUrl}/api/team/mobile-reply`, {
        body: JSON.stringify({
          from_agent_id: orchestratorId,
          project_id: workspace.id,
          text: '没有带 reply_to_user_message_id 的回复。',
          token,
        }),
        headers: jsonHeaders(),
        method: 'POST',
      })
      expect(reply.status).toBe(200)

      expect(
        warnLogs.some((message) => message.includes('mobile reply obligation ambiguous'))
      ).toBe(true)
      expect(
        infoLogs.some((message) => message.includes('mobile reply obligation fulfilled'))
      ).toBe(false)
      const obligationEvents = server.store
        .listMobileChatMessages(workspace.id)
        .filter((message) => message.message_type === 'system_event')
        .map((message) => JSON.parse(message.content_json) as { event?: string })
      expect(obligationEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ event: 'mobile_reply_obligation_ambiguous' }),
        ])
      )
    } finally {
      await server.close()
    }
  })

  test('records WebRTC voice latency correlation from active call runtime state', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer({
      webRtcRuntime: {
        getActiveWorkspaceCallIds: () => ['call-active-runtime'],
        hasActiveWorkspaceCall: () => true,
      },
    })
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Reply Correlation')
      const turn = startWebRtcVoiceLatencyTurn({
        callId: 'call-active-runtime',
        now: 1_000,
        segment: 1,
        workspaceId: workspace.id,
      })
      markWebRtcVoiceLatency(turn.turnId, {
        branch: 'escalate',
        decisionAt: 1_200,
        forwardPm: true,
        intentVerdictAt: 1_150,
        textLen: 10,
      })
      const orchestratorId = `${workspace.id}:orchestrator`
      const orchScript = join(workspacePath, 'orch-mobile-reply-correlation.js')
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
          text: 'PM 已处理。',
          token: orchestratorToken,
        }),
      })
      expect(response.status).toBe(200)

      const messages = server.store.listMobileChatMessages(workspace.id)
      const reply = messages.find((message) => message.message_type === 'orch_reply')
      expect(JSON.parse(reply?.content_json ?? '{}')).toEqual({
        text: 'PM 已处理。',
        voice_latency_turn_id: turn.turnId,
      })
    } finally {
      await server.close()
    }
  })

  test('includes intent generation when team mobile-reply binds to an active WebRTC handoff turn', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer({
      webRtcRuntime: {
        getActiveWorkspaceCallIds: () => ['call-runtime-intent-generation'],
        hasActiveWorkspaceCall: () => true,
      },
    })
    try {
      const workspace = server.store.createWorkspace(
        workspacePath,
        'Mobile Reply Intent Generation'
      )
      const turn = startWebRtcVoiceLatencyTurn({
        callId: 'call-runtime-intent-generation',
        now: 1_000,
        segment: 1,
        workspaceId: workspace.id,
      })
      markWebRtcVoiceLatency(turn.turnId, {
        branch: 'escalate',
        decisionAt: 1_200,
        forwardPm: true,
        intentGeneration: 7,
        intentVerdictAt: 1_150,
        textLen: 10,
      })
      const orchestratorId = `${workspace.id}:orchestrator`
      const orchScript = join(workspacePath, 'orch-mobile-reply-intent-generation.js')
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
          text: 'PM 已处理。',
          token: orchestratorToken,
        }),
      })
      expect(response.status).toBe(200)

      const messages = server.store.listMobileChatMessages(workspace.id)
      const reply = messages.find((message) => message.message_type === 'orch_reply')
      expect(JSON.parse(reply?.content_json ?? '{}')).toEqual({
        intent_generation: 7,
        text: 'PM 已处理。',
        voice_latency_turn_id: turn.turnId,
      })
    } finally {
      await server.close()
    }
  })

  test('does not add WebRTC voice latency correlation outside an active call', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer({
      webRtcRuntime: {
        getActiveWorkspaceCallIds: () => [],
        hasActiveWorkspaceCall: () => false,
      },
    })
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Reply No Call')
      startWebRtcVoiceLatencyTurn({
        callId: 'call-inactive-runtime',
        now: 1_000,
        segment: 1,
        workspaceId: workspace.id,
      })
      const orchestratorId = `${workspace.id}:orchestrator`
      const orchScript = join(workspacePath, 'orch-mobile-reply-no-call.js')
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
          text: '普通回复。',
          token: orchestratorToken,
        }),
      })
      expect(response.status).toBe(200)

      const messages = server.store.listMobileChatMessages(workspace.id)
      const reply = messages.find((message) => message.message_type === 'orch_reply')
      expect(JSON.parse(reply?.content_json ?? '{}')).toEqual({
        text: '普通回复。',
      })
    } finally {
      await server.close()
    }
  })

  test('binds a team mobile-reply to the explicitly correlated WebRTC handoff turn', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer({
      webRtcRuntime: {
        getActiveWorkspaceCallIds: () => ['call-runtime-order'],
        hasActiveWorkspaceCall: () => true,
      },
    })
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Reply Order')
      const turn1 = startWebRtcVoiceLatencyTurn({
        callId: 'call-runtime-order',
        now: 1_000,
        segment: 1,
        workspaceId: workspace.id,
      })
      markWebRtcVoiceLatency(turn1.turnId, {
        branch: 'escalate',
        decisionAt: 1_200,
        forwardPm: true,
        intentGeneration: 1,
        intentVerdictAt: 1_150,
        textLen: 5,
      })
      const turn2 = startWebRtcVoiceLatencyTurn({
        callId: 'call-runtime-order',
        now: 2_000,
        segment: 2,
        workspaceId: workspace.id,
      })
      markWebRtcVoiceLatency(turn2.turnId, {
        branch: 'escalate',
        decisionAt: 2_200,
        forwardPm: true,
        intentGeneration: 2,
        intentVerdictAt: 2_150,
        textLen: 6,
      })
      const orchestratorId = `${workspace.id}:orchestrator`
      const orchScript = join(workspacePath, 'orch-mobile-reply-order.js')
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
          text: '第二条 PM 回复。',
          token: orchestratorToken,
          voice_latency_turn_id: turn2.turnId,
        }),
      })
      expect(response.status).toBe(200)

      const replies = server.store
        .listMobileChatMessages(workspace.id)
        .filter((message) => message.message_type === 'orch_reply')
        .map((message) => JSON.parse(message.content_json) as Record<string, unknown>)
      expect(replies).toEqual([
        {
          intent_generation: 2,
          text: '第二条 PM 回复。',
          voice_latency_turn_id: turn2.turnId,
        },
      ])
      expect(
        claimOldestPendingWebRtcVoiceHandoffTurn(workspace.id, { callIds: ['call-runtime-order'] })
          ?.turnId
      ).toBe(turn1.turnId)
    } finally {
      await server.close()
    }
  })

  test('team mobile-reply CLI can pass a hidden WebRTC voice latency correlation', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer({
      webRtcRuntime: {
        getActiveWorkspaceCallIds: () => ['call-runtime-cli-correlation'],
        hasActiveWorkspaceCall: () => true,
      },
    })
    const previousEnv = { ...process.env }
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Reply CLI Correlation')
      const turn1 = startWebRtcVoiceLatencyTurn({
        callId: 'call-runtime-cli-correlation',
        now: 1_000,
        segment: 1,
        workspaceId: workspace.id,
      })
      markWebRtcVoiceLatency(turn1.turnId, {
        branch: 'escalate',
        forwardPm: true,
        intentGeneration: 1,
      })
      const turn2 = startWebRtcVoiceLatencyTurn({
        callId: 'call-runtime-cli-correlation',
        now: 2_000,
        segment: 2,
        workspaceId: workspace.id,
      })
      markWebRtcVoiceLatency(turn2.turnId, {
        branch: 'escalate',
        forwardPm: true,
        intentGeneration: 2,
      })
      const orchestratorId = `${workspace.id}:orchestrator`
      const orchScript = join(workspacePath, 'orch-mobile-reply-cli-correlation.js')
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
      process.env = {
        ...previousEnv,
        HIVE_AGENT_ID: orchestratorId,
        HIVE_AGENT_TOKEN: orchestratorToken,
        HIVE_PORT: new URL(server.baseUrl).port,
        HIVE_PROJECT_ID: workspace.id,
      }

      await runTeamCommand([
        'mobile-reply',
        '--voice-latency-turn-id',
        turn2.turnId,
        '第二条 PM CLI 回复。',
      ])

      const replies = server.store
        .listMobileChatMessages(workspace.id)
        .filter((message) => message.message_type === 'orch_reply')
        .map((message) => JSON.parse(message.content_json) as Record<string, unknown>)
      expect(replies).toEqual([
        {
          intent_generation: 2,
          text: '第二条 PM CLI 回复。',
          voice_latency_turn_id: turn2.turnId,
        },
      ])
      expect(
        claimOldestPendingWebRtcVoiceHandoffTurn(workspace.id, {
          callIds: ['call-runtime-cli-correlation'],
        })?.turnId
      ).toBe(turn1.turnId)
    } finally {
      process.env = previousEnv
      await server.close()
    }
  })

  test('rejects ambiguous active WebRTC handoff replies without downlink when correlation is missing', async () => {
    const workspacePath = createWorkspaceFixture()
    const warnLogs: string[] = []
    const server = await startTestServer({
      logger: {
        async close() {},
        error: () => {},
        info: () => {},
        warn: (message) => warnLogs.push(message),
      },
      webRtcRuntime: {
        getActiveWorkspaceCallIds: () => ['call-runtime-ambiguous'],
        hasActiveWorkspaceCall: () => true,
      },
    })
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Reply Ambiguous')
      const synthesizeCalls: string[] = []
      const sentFrames: Array<{ type: string }> = []
      const downlink = createWebRtcFileDownlinkAudio({
        createTtsProvider: () => ({
          detect: async () => ({ command: 'edge-tts', provider: 'edge-tts' }),
          synthesize: async (text) => {
            synthesizeCalls.push(text)
            return {
              audio: Buffer.from('reply-audio'),
              format: 'mp3',
              mime: 'audio/mpeg',
              provider: 'edge-tts',
            }
          },
        }),
        logger: { info: () => {}, warn: () => {} },
        store: server.store,
      })
      const downlinkSession = await downlink.startCall({
        callId: 'call-runtime-ambiguous',
        send: (frame) => sentFrames.push(frame),
        workspaceId: workspace.id,
      })
      const turn1 = startWebRtcVoiceLatencyTurn({
        callId: 'call-runtime-ambiguous',
        now: 1_000,
        segment: 1,
        workspaceId: workspace.id,
      })
      markWebRtcVoiceLatency(turn1.turnId, {
        branch: 'escalate',
        forwardPm: true,
        intentGeneration: 1,
      })
      const turn2 = startWebRtcVoiceLatencyTurn({
        callId: 'call-runtime-ambiguous',
        now: 2_000,
        segment: 2,
        workspaceId: workspace.id,
      })
      markWebRtcVoiceLatency(turn2.turnId, {
        branch: 'escalate',
        forwardPm: true,
        intentGeneration: 2,
      })
      const orchestratorId = `${workspace.id}:orchestrator`
      const orchScript = join(workspacePath, 'orch-mobile-reply-ambiguous.js')
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
          text: '无法确定对应哪一轮的 PM 回复。',
          token: orchestratorToken,
        }),
      })
      expect(response.status).toBe(409)
      await downlinkSession.flush()
      expect(await response.json()).toEqual(
        expect.objectContaining({
          error: expect.stringContaining('voice_latency_turn_id'),
        })
      )

      const replies = server.store
        .listMobileChatMessages(workspace.id)
        .filter((message) => message.message_type === 'orch_reply')
        .map((message) => JSON.parse(message.content_json) as Record<string, unknown>)
      expect(replies).toEqual([])
      expect(synthesizeCalls).toEqual([])
      expect(sentFrames.filter((frame) => frame.type === 'voice_downlink_segment')).toEqual([])
      expect(warnLogs).toEqual(
        expect.arrayContaining([
          expect.stringContaining('team mobile reply WebRTC handoff ambiguous'),
        ])
      )
      const systemEvents = server.store
        .listMobileChatMessages(workspace.id)
        .filter((message) => message.message_type === 'system_event')
        .map((message) => JSON.parse(message.content_json) as Record<string, unknown>)
      expect(systemEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'webrtc_handoff_mobile_reply_ambiguous',
            pending_handoff_turns: 2,
          }),
        ])
      )
      expect(
        claimOldestPendingWebRtcVoiceHandoffTurn(workspace.id, {
          callIds: ['call-runtime-ambiguous'],
        })?.turnId
      ).toBe(turn1.turnId)
      expect(
        claimOldestPendingWebRtcVoiceHandoffTurn(workspace.id, {
          callIds: ['call-runtime-ambiguous'],
        })?.turnId
      ).toBe(turn2.turnId)
      await downlinkSession.close()
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

  test('accepts mobile uploads above 50MB up to the 100MB video limit', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Large Upload')
      const sender = await createMobileTokenForTest(server.baseUrl, ['send_prompt'], 'Sender')
      const upload = await fetch(`${server.baseUrl}/api/mobile/workspaces/${workspace.id}/upload`, {
        body: JSON.stringify({
          data: Buffer.alloc(51 * 1024 * 1024, 1).toString('base64'),
          filename: 'clip.mp4',
          mime_type: 'video/mp4',
        }),
        headers: jsonHeaders({ host: '192.168.1.44:4010', token: sender.token }),
        method: 'POST',
      })
      const uploaded = (await upload.json()) as { size: number; url: string }
      expect(upload.status).toBe(200)
      expect(uploaded.size).toBe(51 * 1024 * 1024)
      expect(uploaded.url).toMatch(/^\/api\/mobile\/uploads\//)
    } finally {
      await server.close()
    }
  })

  test('rejects mobile uploads over the 100MB video limit after accepting the enlarged JSON body', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Oversized Upload')
      const sender = await createMobileTokenForTest(server.baseUrl, ['send_prompt'], 'Sender')
      const upload = await fetch(`${server.baseUrl}/api/mobile/workspaces/${workspace.id}/upload`, {
        body: JSON.stringify({
          data: Buffer.alloc(101 * 1024 * 1024, 1).toString('base64'),
          filename: 'too-big.mp4',
          mime_type: 'video/mp4',
        }),
        headers: jsonHeaders({ host: '192.168.1.44:4010', token: sender.token }),
        method: 'POST',
      })
      expect(upload.status).toBe(400)
      await expect(upload.json()).resolves.toMatchObject({
        error: 'File too large (max 100MB)',
      })
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

  test('expires stale pending mobile uploads before later prompt submission', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Mobile Upload Expiry')
      const orchestratorId = `${workspace.id}:orchestrator`
      const orchScript = join(workspacePath, 'orch-upload-expire-echo.js')
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

      const device = await createMobileTokenForTest(server.baseUrl, ['send_prompt'], 'Phone A')
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'))

      const staleUpload = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/upload`,
        {
          body: JSON.stringify({
            data: Buffer.from('stale image').toString('base64'),
            filename: 'stale.png',
            mime_type: 'image/png',
          }),
          headers: jsonHeaders({ host: '192.168.1.44:4010', token: device.token }),
          method: 'POST',
        }
      )
      const staleBody = (await staleUpload.json()) as { file_id: string }
      expect(staleUpload.status).toBe(200)

      vi.setSystemTime(new Date('2026-06-01T00:06:00.000Z'))

      const prompt = await fetch(`${server.baseUrl}/api/mobile/workspaces/${workspace.id}/prompt`, {
        body: JSON.stringify({ text: 'Plain text after abandoned upload' }),
        headers: jsonHeaders({ host: '192.168.1.44:4010', token: device.token }),
        method: 'POST',
      })
      expect(prompt.status).toBe(200)

      const recoveryMessages = server.store.listMessagesForRecovery(workspace.id, 0)
      const promptMessage = recoveryMessages.find((message) =>
        message.text.includes('Plain text after abandoned upload')
      )
      expect(promptMessage?.text).not.toContain(staleBody.file_id)
      expect(promptMessage?.text).not.toContain('[Image: source:')
    } finally {
      await server.close()
    }
  })

  test('GLM gatekeeper handled voice prompt injects FYI context without mobile reply obligation over LAN', async () => {
    await withMockedGlmFastReply('HIVE_GLM_GATEKEEPER: handled\n当前暂无未完成派单。', async () => {
      vi.stubEnv('HIVE_GLM_GATEKEEPER', '1')
      vi.stubEnv('HIVE_VOICE_UNDERSTANDING_WINDOW_MS', '0')
      const workspacePath = createWorkspaceFixture()
      const server = await startTestServer()
      try {
        const workspace = server.store.createWorkspace(workspacePath, 'Mobile Gatekeeper LAN')
        const orchestratorId = `${workspace.id}:orchestrator`
        const orchScript = join(workspacePath, 'orch-gatekeeper-lan-echo.js')
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
        await server.store.startAgent(workspace.id, orchestratorId, { hivePort: '4010' })
        const device = await createMobileTokenForTest(server.baseUrl, ['send_prompt'], 'Phone A')

        const prompt = await fetch(
          `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/prompt`,
          {
            body: JSON.stringify({ source: 'voice', text: '现在有未完成派单吗' }),
            headers: jsonHeaders({ host: '192.168.1.44:4010', token: device.token }),
            method: 'POST',
          }
        )

        expect(prompt.status).toBe(200)
        expect(await prompt.json()).toEqual({ ok: true, workspace_id: workspace.id })
        expect(server.store.listMessagesForRecovery(workspace.id, 0)).toContainEqual(
          expect.objectContaining({
            text: expect.stringContaining('[来自手机 Mobile App]\n---\n现在有未完成派单吗'),
            type: 'user_input',
          })
        )
        await waitFor(() => {
          const output = server.store.getActiveRunByAgentId(workspace.id, orchestratorId)?.output
          expect(output).toContain('现在有未完成派单吗')
          expect(output).toContain('前台(GLM)已就此条答复用户')
          expect(output).toContain('仅供你保持上下文，无需回复')
          expect(output).toContain('当前暂无未完成派单。')
        })
        const fastReply = server.store
          .listMobileChatMessages(workspace.id)
          .find((message) => message.message_type === 'orch_reply')
        expect(JSON.parse(fastReply?.content_json ?? '{}')).toMatchObject({
          gatekeeper: 'handled',
          text: '当前暂无未完成派单。',
        })
        expect(
          server.store
            .listMobileChatMessages(workspace.id)
            .some((message) => message.message_type === 'system_event')
        ).toBe(false)
      } finally {
        await server.close()
      }
    })
  })

  test('GLM gatekeeper escalates operation-like voice prompts over LAN', async () => {
    await withMockedGlmFastReply(
      'HIVE_GLM_GATEKEEPER: escalate\n好，我让 orchestrator 去办。',
      async () => {
        vi.stubEnv('HIVE_GLM_GATEKEEPER', '1')
        vi.stubEnv('HIVE_VOICE_UNDERSTANDING_WINDOW_MS', '0')
        const workspacePath = createWorkspaceFixture()
        const server = await startTestServer()
        try {
          const workspace = server.store.createWorkspace(
            workspacePath,
            'Mobile Gatekeeper Escalate'
          )
          const orchestratorId = `${workspace.id}:orchestrator`
          const orchScript = join(workspacePath, 'orch-gatekeeper-escalate-echo.js')
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
          await server.store.startAgent(workspace.id, orchestratorId, { hivePort: '4010' })
          const device = await createMobileTokenForTest(server.baseUrl, ['send_prompt'], 'Phone A')

          const prompt = await fetch(
            `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/prompt`,
            {
              body: JSON.stringify({ source: 'voice', text: '让关羽修一下对讲' }),
              headers: jsonHeaders({ host: '192.168.1.44:4010', token: device.token }),
              method: 'POST',
            }
          )

          expect(prompt.status).toBe(200)
          await waitFor(() => {
            expect(
              server.store.getActiveRunByAgentId(workspace.id, orchestratorId)?.output
            ).toContain('让关羽修一下对讲')
          })
          const output = server.store.getActiveRunByAgentId(workspace.id, orchestratorId)?.output
          expect(output).toContain('GLM 已经对用户回复了:"好，我让 orchestrator 去办。"')
          expect(output).toContain('绝不重复')
          expect(output).toContain('无需补充')
          const fastReply = server.store
            .listMobileChatMessages(workspace.id)
            .find((message) => message.direction === 'outbound')
          expect(fastReply?.message_type).toBe('orch_reply')
          expect(JSON.parse(String(fastReply?.content_json))).toMatchObject({
            fast_reply: true,
            gatekeeper: 'escalate',
            source: 'voice_fast_reply',
            text: '好，我让 orchestrator 去办。',
          })
        } finally {
          await server.close()
        }
      }
    )
  })

  test('GLM gatekeeper drops team-name prompt echo noise over LAN without GLM or orchestrator', async () => {
    await withMockedGlmFastReply('HIVE_GLM_GATEKEEPER: handled\n我在。', async () => {
      vi.stubEnv('HIVE_GLM_GATEKEEPER', '1')
      vi.stubEnv('HIVE_VOICE_UNDERSTANDING_WINDOW_MS', '0')
      const workspacePath = createWorkspaceFixture()
      const server = await startTestServer()
      try {
        const workspace = server.store.createWorkspace(workspacePath, 'Mobile Gatekeeper Noise')
        const orchestratorId = `${workspace.id}:orchestrator`
        const orchScript = join(workspacePath, 'orch-gatekeeper-noise-echo.js')
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
        await server.store.startAgent(workspace.id, orchestratorId, { hivePort: '4010' })
        const device = await createMobileTokenForTest(server.baseUrl, ['send_prompt'], 'Phone A')

        const prompt = await fetch(
          `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/prompt`,
          {
            body: JSON.stringify({
              source: 'voice',
              text: '团队成员：关羽、马超、赵云、钟馗、吕布',
            }),
            headers: jsonHeaders({ host: '192.168.1.44:4010', token: device.token }),
            method: 'POST',
          }
        )

        expect(prompt.status).toBe(200)
        expect(await prompt.json()).toEqual({ ok: true, workspace_id: workspace.id })
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(
          server.store.getActiveRunByAgentId(workspace.id, orchestratorId)?.output
        ).not.toContain('团队成员')
        expect(server.store.listMobileChatMessages(workspace.id)).toEqual([])
        expect(server.store.listMessagesForRecovery(workspace.id, 0)).toEqual([])
      } finally {
        await server.close()
      }
    })
  })

  test('GLM gatekeeper forwards handled prompts over LAN when fast reply insert fails', async () => {
    await withMockedGlmFastReply('HIVE_GLM_GATEKEEPER: handled\n当前暂无未完成派单。', async () => {
      vi.stubEnv('HIVE_GLM_GATEKEEPER', '1')
      vi.stubEnv('HIVE_VOICE_UNDERSTANDING_WINDOW_MS', '0')
      const workspacePath = createWorkspaceFixture()
      const server = await startTestServer()
      try {
        const workspace = server.store.createWorkspace(workspacePath, 'Mobile Gatekeeper Fail')
        const orchestratorId = `${workspace.id}:orchestrator`
        const orchScript = join(workspacePath, 'orch-gatekeeper-fail-echo.js')
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
        await server.store.startAgent(workspace.id, orchestratorId, { hivePort: '4010' })
        const originalInsert = server.store.insertMobileChatMessage.bind(server.store)
        vi.spyOn(server.store, 'insertMobileChatMessage').mockImplementation(
          (workspaceId, direction, messageType, contentJson) => {
            if (direction === 'outbound' && messageType === 'orch_reply') {
              throw new Error('database is locked')
            }
            return originalInsert(workspaceId, direction, messageType, contentJson)
          }
        )
        const device = await createMobileTokenForTest(server.baseUrl, ['send_prompt'], 'Phone A')

        const prompt = await fetch(
          `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/prompt`,
          {
            body: JSON.stringify({ source: 'voice', text: '现在有未完成派单吗' }),
            headers: jsonHeaders({ host: '192.168.1.44:4010', token: device.token }),
            method: 'POST',
          }
        )

        expect(prompt.status).toBe(200)
        await waitFor(() => {
          expect(
            server.store.getActiveRunByAgentId(workspace.id, orchestratorId)?.output
          ).toContain('现在有未完成派单吗')
        })
      } finally {
        await server.close()
      }
    })
  })

  test('GLM gatekeeper flag off forwards handled voice prompts over LAN', async () => {
    await withMockedGlmFastReply('HIVE_GLM_GATEKEEPER: handled\n当前暂无未完成派单。', async () => {
      vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
      vi.stubEnv('HIVE_VOICE_UNDERSTANDING_WINDOW_MS', '0')
      const workspacePath = createWorkspaceFixture()
      const server = await startTestServer()
      try {
        const workspace = server.store.createWorkspace(workspacePath, 'Mobile Gatekeeper Off')
        const orchestratorId = `${workspace.id}:orchestrator`
        const orchScript = join(workspacePath, 'orch-gatekeeper-off-echo.js')
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
        await server.store.startAgent(workspace.id, orchestratorId, { hivePort: '4010' })
        const device = await createMobileTokenForTest(server.baseUrl, ['send_prompt'], 'Phone A')

        const prompt = await fetch(
          `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/prompt`,
          {
            body: JSON.stringify({ source: 'voice', text: '现在有未完成派单吗' }),
            headers: jsonHeaders({ host: '192.168.1.44:4010', token: device.token }),
            method: 'POST',
          }
        )

        expect(prompt.status).toBe(200)
        await waitFor(() => {
          expect(
            server.store.getActiveRunByAgentId(workspace.id, orchestratorId)?.output
          ).toContain('现在有未完成派单吗')
        })
      } finally {
        await server.close()
      }
    })
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

  test('records mobile approval decisions after approval ledger reload', async () => {
    const workspacePath = createWorkspaceFixture()
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-mobile-approval-reload-'))
    tempDirs.push(dataDir)
    const first = await startTestServer({ dataDir })
    let workspaceId = ''
    let orchestratorId = ''
    let approvalId = ''
    try {
      const workspace = first.store.createWorkspace(workspacePath, 'Mobile Approval Reload')
      workspaceId = workspace.id
      orchestratorId = `${workspace.id}:orchestrator`
      const orchScript = join(workspacePath, 'orch-approval-reload-echo.js')
      writeFileSync(
        orchScript,
        [
          "process.stdin.setEncoding('utf8')",
          "process.stdin.on('data', (chunk) => process.stdout.write('ORCH:' + chunk))",
        ].join('\n'),
        'utf8'
      )
      first.store.configureAgentLaunch(workspace.id, orchestratorId, {
        args: ['-lc', `"${process.execPath}" "${orchScript}"`],
        command: '/bin/bash',
      })
      const approval = first.store.approvalLedger.create({
        action: 'Approve after restart',
        chatId: 'oc_mobile',
        messageId: 'om_mobile',
        orchAgentId: orchestratorId,
        risk: 'high',
        target: null,
        workspaceId: workspace.id,
      })
      approvalId = approval.approvalId
    } finally {
      await first.close()
    }

    const restarted = await startTestServer({ dataDir })
    try {
      const run = await restarted.store.startAgent(workspaceId, orchestratorId, {
        hivePort: '4010',
      })
      const approver = await createMobileTokenForTest(
        restarted.baseUrl,
        ['approve_risk'],
        'Approver after reload'
      )

      const decided = await fetch(
        `${restarted.baseUrl}/api/mobile/workspaces/${workspaceId}/approve/${approvalId}`,
        {
          headers: jsonHeaders({ host: '192.168.1.44:4010', token: approver.token }),
          method: 'POST',
          body: JSON.stringify({ decision: 'allow' }),
        }
      )
      const body = (await decided.json()) as { approval_id: string; decision: string; ok: boolean }

      expect(decided.status).toBe(200)
      expect(body).toMatchObject({
        approval_id: approvalId,
        decision: 'allow',
        ok: true,
        status: 'recorded',
      })
      expect(restarted.store.approvalLedger.get(approvalId)).toBeNull()
      await waitFor(() => {
        const activeRun = restarted.store.getLiveRun(run.runId)
        expect(activeRun.output).toContain(`approval_id=${approvalId} ALLOWED`)
        expect(activeRun.output).toContain('action: Approve after restart')
      })
    } finally {
      await restarted.close()
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

  test('transcript preserves leading indentation through the real worker PTY (trimEnd, not trim)', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Indent Transcript')
      const worker = server.store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
      server.store.configureAgentLaunch(workspace.id, worker.id, {
        command: process.execPath,
        args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'],
      })
      const run = await server.store.startAgent(workspace.id, worker.id, { hivePort: '4010' })
      server.store.getPtyOutputBus().publish(run.runId, '    indented child node   \r\n')
      await new Promise((resolve) => setTimeout(resolve, 20))

      const { token } = await createMobileTokenForTest(server.baseUrl)
      const response = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/workers/${worker.id}/transcript`,
        { headers: mobileHeaders(token, '192.168.1.44:4010') }
      )
      const body = (await response.json()) as { lines: string[] }
      expect(response.status).toBe(200)
      const indented = body.lines.find((line) => line.includes('indented child node'))
      // 前导缩进保留（不再被 .trim() 删掉），行尾空格裁掉。
      expect(indented).toBe('    indented child node')
    } finally {
      await server.close()
    }
  }, 15000)

  test('transcript layer resolves CR overwrite + keeps indent (crafted snapshot)', async () => {
    // 直接喂含字面 \r 覆盖 + 前导 Tab + \r\n 行尾 + ANSI 的快照（真实 PTY 经 headless xterm 会
    // 提前解掉覆盖，这里绕开以直接验服务端 transcript 变换）。非 mock node-pty，只 stub 快照源。
    const esc = String.fromCharCode(0x1b)
    const snapshot = `${esc}[32m\tdeploy step${esc}[0m\r\nprogress 1%\rprogress 2%\rprogress 100%\r\n   kept   \r\n`
    const fakeStore = {
      getAgent: () => ({
        description: '',
        id: 'w1',
        name: 'Alice',
        pendingTaskCount: 0,
        role: 'coder' as const,
        status: 'idle' as const,
        workspaceId: 'ws1',
      }),
      getPtySnapshotForAgent: async () => snapshot,
    } as unknown as Parameters<typeof buildMobileWorkerTranscript>[0]

    const result = await buildMobileWorkerTranscript(fakeStore, 'ws1', 'w1')
    expect(result.lines[0]).toBe('\tdeploy step') // 前导 Tab 保留、ANSI 已 strip
    expect(result.lines[1]).toBe('progress 100%') // \r 覆盖只留最后一次写入
    expect(result.lines.some((line) => line.includes('progress 1%'))).toBe(false)
    expect(result.lines[2]).toBe('   kept') // 前导空格保留、行尾裁掉
    expect(result.lines.join('\n')).not.toContain(`${esc}[`)
  })

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
        text: 'done',
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
          worker_id: string
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
      const firstDispatch = body.dispatches[0]
      expect(firstDispatch).toBeDefined()
      if (!firstDispatch) throw new Error('expected at least one mobile task')
      expect(firstDispatch.worker_name).toBe('Alice')
      expect(firstDispatch.worker_id).toBe(worker.id)
      expect(firstDispatch.task_summary.length).toBeLessThanOrEqual(80)
      expect(new Date(firstDispatch.created_at).toString()).not.toBe('Invalid Date')
    } finally {
      await server.close()
    }
  })
})
