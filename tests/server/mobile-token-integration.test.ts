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

const jsonHeaders = (input: { cookie?: string; host?: string; token?: string } = {}) => ({
  'content-type': 'application/json',
  ...(input.cookie ? { cookie: input.cookie } : {}),
  ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
  ...(input.host ? { host: input.host } : {}),
})

const createToken = async (
  baseUrl: string,
  cookie: string,
  capabilities = ['read_dashboard'],
  name = 'Test phone'
) => {
  const response = await fetch(`${baseUrl}/api/mobile/tokens`, {
    headers: jsonHeaders({ cookie }),
    method: 'POST',
    body: JSON.stringify({ capabilities, name }),
  })
  return {
    body: (await response.json()) as { device_id: string; token: string },
    status: response.status,
  }
}

const createWorkspace = (
  store: ReturnType<typeof import('../../src/server/runtime-store.js').createRuntimeStore>,
  path: string,
  name: string
) => {
  const workspace = store.createWorkspace(path, name)
  store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
  return workspace
}

describe('mobile token flow integration', () => {
  test('created token can access dashboard over LAN', async () => {
    const server = await startTestServer()
    tempDirs.push(server.dataDir)
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-token-flow-'))
    tempDirs.push(workspacePath)
    mkdirSync(join(workspacePath, '.hive'), { recursive: true })
    writeFileSync(
      join(workspacePath, '.hive', 'plan.md'),
      '---\ntitle: Token Flow\n---\n## 目标\n\nGoal.',
      'utf8'
    )
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const workspace = createWorkspace(server.store, workspacePath, 'Token Flow')
      const { body: created, status } = await createToken(server.baseUrl, cookie)

      expect(status).toBe(200)
      expect(created.token).toMatch(/^[A-Za-z0-9_-]{32,}$/)

      const dashboard = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/dashboard`,
        { headers: { authorization: `Bearer ${created.token}`, host: '192.168.1.44:4010' } }
      )
      expect(dashboard.status).toBe(200)
      const dashBody = (await dashboard.json()) as { workspace: { id: string } }
      expect(dashBody.workspace.id).toBe(workspace.id)
    } finally {
      await server.close()
    }
  })

  test('read_dashboard token cannot dispatch without send_prompt capability', async () => {
    const server = await startTestServer()
    tempDirs.push(server.dataDir)
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-cap-'))
    tempDirs.push(workspacePath)
    mkdirSync(join(workspacePath, '.hive'), { recursive: true })
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const workspace = createWorkspace(server.store, workspacePath, 'Cap Test')
      const worker = server.store.listWorkers(workspace.id)[0]

      const { body: created } = await createToken(server.baseUrl, cookie, ['read_dashboard'])

      const dispatch = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/dispatch`,
        {
          headers: jsonHeaders({ host: '192.168.1.44:4010', token: created.token }),
          method: 'POST',
          body: JSON.stringify({ task: 'Try dispatch', worker_id: worker?.id }),
        }
      )
      expect(dispatch.status).toBe(403)
    } finally {
      await server.close()
    }
  })

  test('UI session can retrieve an existing device token for QR display', async () => {
    const server = await startTestServer()
    tempDirs.push(server.dataDir)
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const { body: created } = await createToken(server.baseUrl, cookie, [
        'read_dashboard',
        'send_prompt',
      ])

      const response = await fetch(`${server.baseUrl}/api/mobile/tokens/${created.device_id}`, {
        headers: jsonHeaders({ cookie }),
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        device: { capabilities: string[]; id: string; name: string }
        token: string
      }
      expect(body.token).toBe(created.token)
      expect(body.device).toMatchObject({
        capabilities: ['read_dashboard', 'send_prompt'],
        id: created.device_id,
        name: 'Test phone',
      })
    } finally {
      await server.close()
    }
  })

  test('existing device token retrieval requires UI auth', async () => {
    const server = await startTestServer()
    tempDirs.push(server.dataDir)
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const { body: created } = await createToken(server.baseUrl, cookie)

      const response = await fetch(`${server.baseUrl}/api/mobile/tokens/${created.device_id}`)
      expect(response.status).toBe(403)

      const mobileAuthResponse = await fetch(
        `${server.baseUrl}/api/mobile/tokens/${created.device_id}`,
        {
          headers: jsonHeaders({ token: created.token }),
        }
      )
      expect(mobileAuthResponse.status).toBe(403)
    } finally {
      await server.close()
    }
  })

  test('device token can access dashboard of any workspace', async () => {
    const server = await startTestServer()
    tempDirs.push(server.dataDir)
    const wsPath1 = mkdtempSync(join(tmpdir(), 'hive-ws1-'))
    const wsPath2 = mkdtempSync(join(tmpdir(), 'hive-ws2-'))
    tempDirs.push(wsPath1, wsPath2)
    mkdirSync(join(wsPath1, '.hive'), { recursive: true })
    mkdirSync(join(wsPath2, '.hive'), { recursive: true })
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const ws1 = createWorkspace(server.store, wsPath1, 'WS1')
      createWorkspace(server.store, wsPath2, 'WS2')

      const { body: created } = await createToken(server.baseUrl, cookie, ['read_dashboard'])

      const dashWs1 = await fetch(`${server.baseUrl}/api/mobile/workspaces/${ws1.id}/dashboard`, {
        headers: { authorization: `Bearer ${created.token}`, host: '192.168.1.44:4010' },
      })
      expect(dashWs1.status).toBe(200)
    } finally {
      await server.close()
    }
  })

  test('deleted token returns 401 on mobile endpoints', async () => {
    const server = await startTestServer()
    tempDirs.push(server.dataDir)
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const { body: created } = await createToken(server.baseUrl, cookie)

      const dashboard = await fetch(`${server.baseUrl}/api/mobile/workspaces`, {
        headers: { authorization: `Bearer ${created.token}`, host: '192.168.1.44:4010' },
      })
      expect(dashboard.status).toBe(200)

      const deleted = await fetch(`${server.baseUrl}/api/mobile/tokens/${created.device_id}`, {
        headers: jsonHeaders({ cookie }),
        method: 'DELETE',
      })
      expect(deleted.status).toBe(200)

      const after = await fetch(`${server.baseUrl}/api/mobile/workspaces`, {
        headers: { authorization: `Bearer ${created.token}`, host: '192.168.1.44:4010' },
      })
      expect(after.status).toBe(401)
    } finally {
      await server.close()
    }
  })
})
