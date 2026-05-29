import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { createAgentManager } from '../../src/server/agent-manager.js'
import { createApp } from '../../src/server/app.js'
import { createRuntimeStore } from '../../src/server/runtime-store.js'

const servers: Array<{ close: () => void }> = []
const tempDirs: string[] = []

afterEach(() => {
  while (servers.length > 0) {
    servers.pop()?.close()
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const startServer = async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hive-runtime-status-'))
  tempDirs.push(dataDir)
  const store = createRuntimeStore({ agentManager: createAgentManager(), dataDir })
  const app = createApp({
    runtimeInfo: { dataDir, port: 4567 },
    store,
    versionService: {
      getVersionInfo: async () => ({
        current_version: '1.2.3-test',
        install_hint: 'npm update -g @tt-a1i/hive',
        latest_version: '1.2.3-test',
        package_name: '@tt-a1i/hive',
        release_url: 'https://www.npmjs.com/package/@tt-a1i/hive/v/1.2.3-test',
        update_available: false,
      }),
    },
  })

  await new Promise<void>((resolve) => {
    app.server.listen(0, '127.0.0.1', () => resolve())
  })
  servers.push(app.server)

  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('No port')

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    uiToken: store.getUiToken(),
    dataDir,
  }
}

describe('GET /api/runtime/status', () => {
  test('returns current runtime identity fields for the local UI', async () => {
    const { baseUrl, dataDir, uiToken } = await startServer()

    const response = await fetch(`${baseUrl}/api/runtime/status`, {
      headers: { cookie: `hive_ui_token=${uiToken}` },
    })
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body).toEqual({
      cwd: process.cwd(),
      db_path: join(dataDir, 'runtime.sqlite'),
      lan_addresses: expect.any(Array),
      log_path: join(dataDir, 'logs', 'runtime-4567.log'),
      pid: process.pid,
      port: 4567,
      version: '1.2.3-test',
    })
    expect(
      (body.lan_addresses as unknown[]).every(
        (address) =>
          typeof address === 'string' &&
          /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address) &&
          address !== '127.0.0.1'
      )
    ).toBe(true)
    expect(typeof body.cwd).toBe('string')
    expect(typeof body.db_path).toBe('string')
    expect(Array.isArray(body.lan_addresses)).toBe(true)
    expect(typeof body.log_path).toBe('string')
    expect(typeof body.pid).toBe('number')
    expect(typeof body.port).toBe('number')
    expect(typeof body.version).toBe('string')
  })

  test('requires the UI token', async () => {
    const { baseUrl } = await startServer()

    const response = await fetch(`${baseUrl}/api/runtime/status`)

    expect(response.status).toBe(403)
  })
})
