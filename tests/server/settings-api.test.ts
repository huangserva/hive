import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { startTestServer } from '../helpers/test-server.js'
import { getUiCookie } from '../helpers/ui-session.js'

const servers: Array<Awaited<ReturnType<typeof startTestServer>>> = []
const tempDirs: string[] = []

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.close()
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

describe('settings api', () => {
  test('settings secrets endpoints store keys and never return plaintext', async () => {
    const server = await startTestServer()
    servers.push(server)
    const cookie = await getUiCookie(server.baseUrl)

    const writeResponse = await fetch(`${server.baseUrl}/api/settings/secrets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ key: 'GLM_API_KEY', value: 'glm-secret-from-ui' }),
    })

    expect(writeResponse.status).toBe(200)
    expect(await writeResponse.json()).toEqual({ key: 'GLM_API_KEY', present: true })

    const readResponse = await fetch(`${server.baseUrl}/api/settings/secrets`, {
      headers: { cookie },
    })
    expect(readResponse.status).toBe(200)
    const bodyText = await readResponse.text()

    expect(bodyText).not.toContain('glm-secret-from-ui')
    expect(JSON.parse(bodyText)).toEqual({
      secrets: {
        ANTHROPIC_API_KEY: { present: false },
        ANTHROPIC_AUTH_TOKEN: { present: false },
        GLM_API_KEY: { present: true },
      },
    })
  })

  test('GET settings endpoints return builtin presets/templates and app_state can round-trip', async () => {
    const server = await startTestServer()
    servers.push(server)
    const cookie = await getUiCookie(server.baseUrl)

    const presetsResponse = await fetch(`${server.baseUrl}/api/settings/command-presets`, {
      headers: { cookie },
    })
    const templatesResponse = await fetch(`${server.baseUrl}/api/settings/role-templates`, {
      headers: { cookie },
    })
    const appStateBeforeResponse = await fetch(
      `${server.baseUrl}/api/settings/app-state/active_workspace_id`,
      { headers: { cookie } }
    )

    expect(presetsResponse.status).toBe(200)
    expect(templatesResponse.status).toBe(200)
    expect(appStateBeforeResponse.status).toBe(200)

    const presets = (await presetsResponse.json()) as Array<{
      capabilities: {
        features: string[]
        provider_family: string
        risk_tier: string
        unattended: boolean | 'unknown'
      }
      display_name: string
      id: string
      yolo_args_template: string[] | null
    }>
    const templates = (await templatesResponse.json()) as Array<{
      default_command: string
      id: string
      name: string
      role_type: string
    }>
    const appStateBefore = (await appStateBeforeResponse.json()) as {
      key: string
      value: string | null
    }

    expect(presets).toEqual([
      expect.objectContaining({
        id: 'claude',
        display_name: 'Claude Code (CC)',
        yolo_args_template: [
          '--dangerously-skip-permissions',
          '--permission-mode=bypassPermissions',
          '--disallowedTools=Task',
        ],
      }),
      expect.objectContaining({
        id: 'codex',
        display_name: 'Codex',
        capabilities: expect.objectContaining({
          provider_family: 'codex',
          risk_tier: 'high',
          unattended: true,
          features: expect.arrayContaining(['browser_e2e', 'mcp', 'session_resume']),
        }),
        yolo_args_template: [
          '--dangerously-bypass-approvals-and-sandbox',
          '-c',
          'mcp_servers.playwright.command="npx"',
          '-c',
          'mcp_servers.playwright.args=["-y","@playwright/mcp@0.0.75","--headless","--isolated","--viewport-size=1440x1000"]',
          '-c',
          'mcp_servers.playwright.startup_timeout_sec=30',
          '-c',
          'mcp_servers.playwright.tool_timeout_sec=60',
        ],
      }),
      expect.objectContaining({
        id: 'opencode',
        display_name: 'OpenCode',
        yolo_args_template: [],
      }),
      expect.objectContaining({
        id: 'gemini',
        display_name: 'Gemini',
        yolo_args_template: ['--yolo'],
      }),
    ])
    expect(templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'orchestrator',
          name: 'Orchestrator',
          role_type: 'orchestrator',
        }),
        expect.objectContaining({
          default_command: 'claude',
          id: 'coder',
          name: '全栈工程师',
          role_type: 'coder',
        }),
        expect.objectContaining({ id: 'frontend-expert', name: '前端专家', role_type: 'coder' }),
        expect.objectContaining({ id: 'backend-expert', name: '后端专家', role_type: 'coder' }),
        expect.objectContaining({
          id: 'reviewer',
          name: '代码审查员',
          role_type: 'reviewer',
        }),
        expect.objectContaining({ id: 'tester', name: '测试工程师', role_type: 'tester' }),
        expect.objectContaining({ id: 'researcher', name: '调研员', role_type: 'custom' }),
        expect.objectContaining({
          id: 'technical-writer',
          name: '技术文档员',
          role_type: 'custom',
        }),
        expect.objectContaining({
          id: 'devops-engineer',
          name: 'DevOps 工程师',
          role_type: 'coder',
        }),
        expect.objectContaining({ id: 'sentinel', name: '哨兵', role_type: 'sentinel' }),
        expect.objectContaining({ id: 'general-assistant', name: '通用助手', role_type: 'custom' }),
      ])
    )
    expect(appStateBefore).toEqual({ key: 'active_workspace_id', value: null })

    const updateResponse = await fetch(
      `${server.baseUrl}/api/settings/app-state/active_workspace_id`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ value: 'ws-123' }),
      }
    )
    expect(updateResponse.status).toBe(204)

    const appStateAfterResponse = await fetch(
      `${server.baseUrl}/api/settings/app-state/active_workspace_id`,
      { headers: { cookie } }
    )
    expect(await appStateAfterResponse.json()).toEqual({
      key: 'active_workspace_id',
      value: 'ws-123',
    })
  })

  test('custom role template CRUD works and builtins are immutable', async () => {
    const server = await startTestServer()
    servers.push(server)
    const cookie = await getUiCookie(server.baseUrl)

    const createResponse = await fetch(`${server.baseUrl}/api/settings/role-templates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Doc Writer',
        role_type: 'custom',
        description: 'Write docs',
        default_command: 'claude',
        default_args: ['docs'],
        default_env: { DOCS: '1' },
      }),
    })
    expect(createResponse.status).toBe(201)
    const created = (await createResponse.json()) as { id: string; name: string }
    expect(created.name).toBe('Doc Writer')

    const updateResponse = await fetch(
      `${server.baseUrl}/api/settings/role-templates/${created.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          name: 'Doc Editor',
          role_type: 'custom',
          description: 'Edit docs',
          default_command: 'claude',
          default_args: ['docs', '--edit'],
          default_env: { DOCS: '2' },
        }),
      }
    )
    expect(updateResponse.status).toBe(200)
    await expect(updateResponse.json()).resolves.toEqual(
      expect.objectContaining({ id: created.id, name: 'Doc Editor', description: 'Edit docs' })
    )

    const builtinDeleteResponse = await fetch(
      `${server.baseUrl}/api/settings/role-templates/orchestrator`,
      {
        method: 'DELETE',
        headers: { cookie },
      }
    )
    expect(builtinDeleteResponse.status).toBe(409)

    const deleteResponse = await fetch(
      `${server.baseUrl}/api/settings/role-templates/${created.id}`,
      {
        method: 'DELETE',
        headers: { cookie },
      }
    )
    expect(deleteResponse.status).toBe(204)

    const listResponse = await fetch(`${server.baseUrl}/api/settings/role-templates`, {
      headers: { cookie },
    })
    const templates = (await listResponse.json()) as Array<{ id: string }>
    expect(templates.some((template) => template.id === created.id)).toBe(false)
  })

  test('custom command preset CRUD works and builtins are immutable', async () => {
    const server = await startTestServer()
    servers.push(server)
    const cookie = await getUiCookie(server.baseUrl)

    const createResponse = await fetch(`${server.baseUrl}/api/settings/command-presets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        display_name: 'Custom Claude',
        command: 'claude',
        args: ['--foo'],
        env: { HELLO: '1' },
        resume_args_template: '--resume {session_id}',
        session_id_capture: {
          source: 'claude_project_jsonl_dir',
          pattern: '~/.claude/projects/{encoded_cwd}/*.jsonl',
        },
        yolo_args_template: ['--dangerously-skip-permissions'],
      }),
    })
    expect(createResponse.status).toBe(201)
    const created = (await createResponse.json()) as { id: string; display_name: string }
    expect(created.display_name).toBe('Custom Claude')

    const updateResponse = await fetch(
      `${server.baseUrl}/api/settings/command-presets/${created.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          display_name: 'Custom Claude 2',
          command: 'claude',
          args: ['--bar'],
          env: { HELLO: '2' },
          resume_args_template: '--continue {session_id}',
          session_id_capture: null,
          yolo_args_template: null,
        }),
      }
    )
    expect(updateResponse.status).toBe(200)
    await expect(updateResponse.json()).resolves.toEqual(
      expect.objectContaining({ id: created.id, display_name: 'Custom Claude 2' })
    )

    const builtinDeleteResponse = await fetch(
      `${server.baseUrl}/api/settings/command-presets/claude`,
      {
        method: 'DELETE',
        headers: { cookie },
      }
    )
    expect(builtinDeleteResponse.status).toBe(409)

    const deleteResponse = await fetch(
      `${server.baseUrl}/api/settings/command-presets/${created.id}`,
      {
        method: 'DELETE',
        headers: { cookie },
      }
    )
    expect(deleteResponse.status).toBe(204)

    const listResponse = await fetch(`${server.baseUrl}/api/settings/command-presets`, {
      headers: { cookie },
    })
    const presets = (await listResponse.json()) as Array<{ id: string }>
    expect(presets.some((preset) => preset.id === created.id)).toBe(false)
  })

  test('command preset responses expose executable availability', async () => {
    const server = await startTestServer()
    servers.push(server)
    const cookie = await getUiCookie(server.baseUrl)

    const createResponse = await fetch(`${server.baseUrl}/api/settings/command-presets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        display_name: 'Missing CLI',
        command: '__hive_missing_cli__',
        args: [],
        env: {},
        resume_args_template: null,
        session_id_capture: null,
        yolo_args_template: null,
      }),
    })
    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toEqual(
      expect.objectContaining({ available: false, command: '__hive_missing_cli__' })
    )

    const listResponse = await fetch(`${server.baseUrl}/api/settings/command-presets`, {
      headers: { cookie },
    })
    const presets = (await listResponse.json()) as Array<{ available: boolean; command: string }>
    expect(presets.find((preset) => preset.command === '__hive_missing_cli__')).toMatchObject({
      available: false,
    })
  })

  test('CLI detection endpoint reports manual absolute path without leaking host assumptions', async () => {
    const server = await startTestServer()
    servers.push(server)
    const cookie = await getUiCookie(server.baseUrl)
    const binDir = mkdtempSync(join(tmpdir(), 'hive-cli-detection-'))
    tempDirs.push(binDir)
    const codexShim = join(binDir, 'codex-test')
    writeFileSync(codexShim, '#!/bin/sh\necho codex-test 1.2.3\n')
    chmodSync(codexShim, 0o755)

    const writeResponse = await fetch(
      `${server.baseUrl}/api/settings/cli-detection/codex/manual-path`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ path: codexShim }),
      }
    )
    expect(writeResponse.status).toBe(200)
    await expect(writeResponse.json()).resolves.toEqual({
      preset_id: 'codex',
      manual_path: codexShim,
      installed: true,
    })

    const detectResponse = await fetch(`${server.baseUrl}/api/settings/cli-detection`, {
      headers: { cookie },
    })
    expect(detectResponse.status).toBe(200)
    const body = (await detectResponse.json()) as {
      agents: Record<
        string,
        {
          command: string
          installed: boolean
          install_plan: unknown
          path: string | null
          preset_id: string
          version: string | null
        }
      >
    }

    expect(Object.keys(body.agents).sort()).toEqual(['claude', 'codex', 'gemini', 'opencode'])
    expect(body.agents.codex).toEqual({
      command: codexShim,
      installed: true,
      install_plan: null,
      path: codexShim,
      preset_id: 'codex',
      version: 'codex-test 1.2.3',
    })
  })
})
