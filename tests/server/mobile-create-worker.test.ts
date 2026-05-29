import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { startTestServer } from '../helpers/test-server.js'
import { getUiCookie } from '../helpers/ui-session.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const createWorkspaceFixture = () => {
  const workspacePath = mkdtempSync(join(tmpdir(), 'hive-create-worker-'))
  tempDirs.push(workspacePath)
  mkdirSync(join(workspacePath, '.hive'), { recursive: true })
  writeFileSync(join(workspacePath, '.hive', 'tasks.md'), '# Tasks\n', 'utf8')
  return workspacePath
}

const createMobileToken = async (
  baseUrl: string,
  capabilities: string[] = [
    'read_dashboard',
    'read_terminal',
    'send_prompt',
    'approve_risk',
    'admin_runtime',
  ]
) => {
  const cookie = await getUiCookie(baseUrl)
  const response = await fetch(`${baseUrl}/api/mobile/tokens`, {
    body: JSON.stringify({ capabilities, name: 'Create worker test device' }),
    headers: { 'content-type': 'application/json', cookie },
    method: 'POST',
  })
  expect(response.status).toBe(200)
  return (await response.json()) as { device_id: string; token: string }
}

const mobileHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
})

const createWorkerRequest = (
  baseUrl: string,
  workspaceId: string,
  token: string,
  body: Record<string, unknown>
) =>
  fetch(`${baseUrl}/api/mobile/workspaces/${workspaceId}/workers`, {
    body: JSON.stringify(body),
    headers: mobileHeaders(token),
    method: 'POST',
  })

describe('mobile create worker route', () => {
  test('admin_runtime device creates a worker from a command preset', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Create Worker Test')
      const { token } = await createMobileToken(server.baseUrl)

      const response = await createWorkerRequest(server.baseUrl, workspace.id, token, {
        autostart: false,
        command_preset_id: 'claude',
        name: 'Zhao Yun',
        role: 'coder',
      })
      const body = (await response.json()) as {
        agent_start?: { ok: boolean }
        ok: boolean
        worker_id?: string
      }

      expect(response.status).toBe(201)
      expect(body.ok).toBe(true)
      expect(body.worker_id).toBeTruthy()
      // Worker really exists in the store with the requested name/role.
      const workers = server.store.listWorkers(workspace.id)
      const created = workers.find((worker) => worker.name === 'Zhao Yun')
      expect(created).toBeTruthy()
      expect(created?.role).toBe('coder')
      // No autostart requested → not launched.
      expect(body.agent_start?.ok).toBe(false)
      // Launch config wired from the preset.
      const launch = server.store.peekAgentLaunchConfig(workspace.id, created?.id ?? '')
      expect(launch?.commandPresetId).toBe('claude')
    } finally {
      await server.close()
    }
  })

  test('rejects request without admin_runtime capability', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Create Worker Test')
      const { token } = await createMobileToken(server.baseUrl, ['read_dashboard'])

      const response = await createWorkerRequest(server.baseUrl, workspace.id, token, {
        command_preset_id: 'claude',
        name: 'Should Fail',
        role: 'coder',
      })

      expect(response.status).toBe(403)
      expect(server.store.listWorkers(workspace.id).some((w) => w.name === 'Should Fail')).toBe(
        false
      )
    } finally {
      await server.close()
    }
  })

  test('rejects role=sentinel from mobile (sentinels are PC-only)', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Create Worker Test')
      const { token } = await createMobileToken(server.baseUrl)

      const response = await createWorkerRequest(server.baseUrl, workspace.id, token, {
        command_preset_id: 'claude',
        name: 'Zhou Yu',
        role: 'sentinel',
      })

      expect(response.status).toBe(400)
      expect(server.store.listWorkers(workspace.id).some((w) => w.role === 'sentinel')).toBe(false)
    } finally {
      await server.close()
    }
  })

  test('rejects an unknown command preset', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Create Worker Test')
      const { token } = await createMobileToken(server.baseUrl)

      const response = await createWorkerRequest(server.baseUrl, workspace.id, token, {
        command_preset_id: 'does-not-exist',
        name: 'Bad Preset',
        role: 'coder',
      })

      expect(response.status).toBe(400)
      expect(server.store.listWorkers(workspace.id).some((w) => w.name === 'Bad Preset')).toBe(
        false
      )
    } finally {
      await server.close()
    }
  })

  test('never honors startup_command — only the preset command is configured', async () => {
    const workspacePath = createWorkspaceFixture()
    const server = await startTestServer()
    try {
      const workspace = server.store.createWorkspace(workspacePath, 'Create Worker Test')
      const { token } = await createMobileToken(server.baseUrl)

      const response = await createWorkerRequest(server.baseUrl, workspace.id, token, {
        command_preset_id: 'claude',
        name: 'Safe Worker',
        // A malicious caller tries to inject an arbitrary shell command.
        role: 'coder',
        startup_command: 'rm -rf /',
      })

      expect(response.status).toBe(201)
      const created = server.store
        .listWorkers(workspace.id)
        .find((worker) => worker.name === 'Safe Worker')
      expect(created).toBeTruthy()
      const launch = server.store.peekAgentLaunchConfig(workspace.id, created?.id ?? '')
      // The injected startup_command must be ignored: the launch uses the preset, not the payload.
      expect(launch?.commandPresetId).toBe('claude')
      expect(launch?.command).toBe('claude')
      expect(JSON.stringify(launch ?? {})).not.toContain('rm -rf')
    } finally {
      await server.close()
    }
  })

  test('GET /api/mobile/command-presets lists presets for admin_runtime devices', async () => {
    const server = await startTestServer()
    try {
      const { token } = await createMobileToken(server.baseUrl)
      const response = await fetch(`${server.baseUrl}/api/mobile/command-presets`, {
        headers: { authorization: `Bearer ${token}` },
      })
      const body = (await response.json()) as Array<{ id: string; display_name: string }>

      expect(response.status).toBe(200)
      expect(Array.isArray(body)).toBe(true)
      expect(body.some((preset) => preset.id === 'claude')).toBe(true)

      const reader = await createMobileToken(server.baseUrl, ['read_dashboard'])
      const forbidden = await fetch(`${server.baseUrl}/api/mobile/command-presets`, {
        headers: { authorization: `Bearer ${reader.token}` },
      })
      expect(forbidden.status).toBe(403)
    } finally {
      await server.close()
    }
  })
})
