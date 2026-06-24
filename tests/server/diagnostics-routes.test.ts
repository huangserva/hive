import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { startTestServer } from '../helpers/test-server.js'
import { getUiCookie } from '../helpers/ui-session.js'

const servers: Array<Awaited<ReturnType<typeof startTestServer>>> = []

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()?.close()
  }
})

const createWorkspace = async (baseUrl: string, cookie: string) => {
  const response = await fetch(`${baseUrl}/api/workspaces`, {
    body: JSON.stringify({
      autostart_orchestrator: false,
      name: 'Diagnostics',
      path: process.cwd(),
    }),
    headers: { 'content-type': 'application/json', cookie },
    method: 'POST',
  })
  expect(response.status).toBe(201)
  return (await response.json()) as { id: string }
}

const writeRuntimeLog = (dataDir: string, baseUrl: string, content: string) => {
  const logsDir = join(dataDir, 'logs')
  const port = new URL(baseUrl).port
  mkdirSync(logsDir, { recursive: true })
  writeFileSync(join(logsDir, `runtime-${port}.log`), content)
}

describe('diagnostics routes', () => {
  test('returns structured diagnostics with redacted logs and events', async () => {
    const server = await startTestServer()
    servers.push(server)
    const cookie = await getUiCookie(server.baseUrl)
    const workspace = await createWorkspace(server.baseUrl, cookie)
    server.store.setSecret('GLM_API_KEY', 'glm-diagnostic-secret')
    writeRuntimeLog(
      server.dataDir,
      server.baseUrl,
      'boot ok\nglm-diagnostic-secret appeared in runtime log\n'
    )
    server.store.insertMobileChatMessage(
      workspace.id,
      'outbound',
      'system_event',
      JSON.stringify({
        command: 'codex',
        error: 'spawn failed with glm-diagnostic-secret',
        event: 'dispatch_spawn_failed',
        path: '/usr/bin:/custom/bin',
        worker: 'Coder',
        worker_id: 'agent-coder',
      })
    )

    const response = await fetch(`${server.baseUrl}/api/diagnostics`, {
      headers: { cookie },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      cli_detection: { agents: Record<string, unknown> }
      events: Array<{ type: string; payload: { error?: string } }>
      log_tail: { exists: boolean; lines: string[] }
      secrets: { GLM_API_KEY: { present: boolean } }
      system_info: { data_dir: string; platform: string }
    }
    expect(body.system_info.data_dir).toBe(server.dataDir)
    expect(body.system_info.platform).toBe(process.platform)
    expect(body.secrets.GLM_API_KEY.present).toBe(true)
    expect(body.cli_detection.agents).toHaveProperty('codex')
    expect(body.log_tail.exists).toBe(true)
    expect(body.log_tail.lines.join('\n')).toContain('[REDACTED]')
    expect(body.log_tail.lines.join('\n')).not.toContain('glm-diagnostic-secret')
    expect(body.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({ error: 'spawn failed with [REDACTED]' }),
          type: 'dispatch_spawn_failed',
        }),
      ])
    )
  })

  test('exports a redacted diagnostic package without known secret values', async () => {
    const server = await startTestServer()
    servers.push(server)
    const cookie = await getUiCookie(server.baseUrl)
    const workspace = await createWorkspace(server.baseUrl, cookie)
    server.store.setSecret('GLM_API_KEY', 'glm-export-secret')
    writeRuntimeLog(server.dataDir, server.baseUrl, 'line before\nglm-export-secret in log\n')
    server.store.insertMobileChatMessage(
      workspace.id,
      'outbound',
      'system_event',
      JSON.stringify({
        error: 'contains glm-export-secret',
        event: 'dispatch_spawn_failed',
        worker: 'Coder',
      })
    )

    const response = await fetch(`${server.baseUrl}/api/diagnostics/export`, {
      headers: { cookie },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/x-tar')
    expect(response.headers.get('content-disposition')).toContain('hive-diagnostics')
    const packageText = Buffer.from(await response.arrayBuffer()).toString('utf8')
    expect(packageText).toContain('system-info.json')
    expect(packageText).toContain('cli-detection.json')
    expect(packageText).toContain('events.json')
    expect(packageText).toContain('config-summary.json')
    expect(packageText).toContain('[REDACTED]')
    expect(packageText).not.toContain('glm-export-secret')
  })

  test('redacts secrets with quotes backslashes and newlines before serializing diagnostics', async () => {
    const server = await startTestServer()
    servers.push(server)
    const cookie = await getUiCookie(server.baseUrl)
    const workspace = await createWorkspace(server.baseUrl, cookie)
    const secret = 'glm-"quote-\\\\slash-\nline-secret'
    const escapedSecret = JSON.stringify(secret).slice(1, -1)
    server.store.setSecret('GLM_API_KEY', secret)
    writeRuntimeLog(server.dataDir, server.baseUrl, `runtime saw ${secret}\n`)
    server.store.insertMobileChatMessage(
      workspace.id,
      'outbound',
      'system_event',
      JSON.stringify({
        error: `spawn failed with ${secret}`,
        event: 'dispatch_spawn_failed',
        worker: 'Coder',
      })
    )

    const diagnosticsResponse = await fetch(`${server.baseUrl}/api/diagnostics`, {
      headers: { cookie },
    })
    expect(diagnosticsResponse.status).toBe(200)
    const diagnosticsText = await diagnosticsResponse.text()
    const diagnostics = JSON.parse(diagnosticsText) as {
      events: Array<{ payload: { error?: string } }>
      log_tail: { lines: string[] }
    }
    expect(diagnostics.events[0]?.payload.error).toBe('spawn failed with [REDACTED]')
    expect(diagnostics.log_tail.lines.join('\n')).toContain('[REDACTED]')
    expect(diagnosticsText).not.toContain(secret)
    expect(diagnosticsText).not.toContain(escapedSecret)

    const exportResponse = await fetch(`${server.baseUrl}/api/diagnostics/export`, {
      headers: { cookie },
    })
    expect(exportResponse.status).toBe(200)
    const packageText = Buffer.from(await exportResponse.arrayBuffer()).toString('utf8')
    expect(packageText).toContain('[REDACTED]')
    expect(packageText).not.toContain(secret)
    expect(packageText).not.toContain(escapedSecret)
  })

  test('keeps the latest diagnostic events when more than one hundred exist', async () => {
    const server = await startTestServer()
    servers.push(server)
    const cookie = await getUiCookie(server.baseUrl)
    const workspace = await createWorkspace(server.baseUrl, cookie)

    for (let index = 0; index < 105; index += 1) {
      server.store.insertMobileChatMessage(
        workspace.id,
        'outbound',
        'system_event',
        JSON.stringify({
          error: `spawn failure ${index}`,
          event: 'dispatch_spawn_failed',
          worker: 'Coder',
        })
      )
    }

    const response = await fetch(`${server.baseUrl}/api/diagnostics`, {
      headers: { cookie },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { events: Array<{ payload: { error?: string } }> }
    const errors = body.events.map((event) => event.payload.error)
    expect(errors).toContain('spawn failure 104')
    expect(errors).not.toContain('spawn failure 0')
  })

  test('exports active sentinel alerts and requires a UI token', async () => {
    const server = await startTestServer()
    servers.push(server)
    const cookie = await getUiCookie(server.baseUrl)

    const forbidden = await fetch(`${server.baseUrl}/api/diagnostics`)
    expect(forbidden.status).toBe(403)

    const response = await fetch(`${server.baseUrl}/api/diagnostics/export`, {
      headers: { cookie },
    })
    expect(response.status).toBe(200)
    const packageText = Buffer.from(await response.arrayBuffer()).toString('utf8')
    expect(packageText).toContain('active-sentinel-alerts.json')
  })

  test('does not fail when the runtime log file is missing', async () => {
    const server = await startTestServer()
    servers.push(server)
    const cookie = await getUiCookie(server.baseUrl)

    const response = await fetch(`${server.baseUrl}/api/diagnostics`, {
      headers: { cookie },
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { log_tail: { exists: boolean; lines: string[] } }
    expect(body.log_tail).toEqual({ exists: false, lines: [], path: expect.any(String) })
  })
})
