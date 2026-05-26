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

const generateCode = async (
  baseUrl: string,
  cookie: string,
  capabilities = ['read_dashboard'],
  deviceName = 'Test'
) => {
  const response = await fetch(`${baseUrl}/api/mobile/pair/generate`, {
    headers: jsonHeaders({ cookie }),
    method: 'POST',
    body: JSON.stringify({ capabilities, device_name: deviceName }),
  })
  return {
    body: (await response.json()) as { code: string; expires_at: number },
    status: response.status,
  }
}

const redeemCode = async (baseUrl: string, code: string) => {
  const response = await fetch(`${baseUrl}/api/mobile/pair/redeem`, {
    headers: jsonHeaders(),
    method: 'POST',
    body: JSON.stringify({ code }),
  })
  return { body: await response.text(), status: response.status }
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

describe('mobile pairing flow integration', () => {
  test('full pairing flow: generate → redeem → access dashboard with token', async () => {
    const server = await startTestServer()
    tempDirs.push(server.dataDir)
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-pair-flow-'))
    tempDirs.push(workspacePath)
    mkdirSync(join(workspacePath, '.hive'), { recursive: true })
    writeFileSync(
      join(workspacePath, '.hive', 'plan.md'),
      '---\ntitle: Pair Flow\n---\n## 目标\n\nGoal.',
      'utf8'
    )
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const workspace = createWorkspace(server.store, workspacePath, 'Pair Flow')

      const { body: generated, status: genStatus } = await generateCode(server.baseUrl, cookie)
      expect(genStatus).toBe(200)
      expect(generated.code).toMatch(/^\d{6}$/)

      const redeemResp = await fetch(`${server.baseUrl}/api/mobile/pair/redeem`, {
        headers: jsonHeaders(),
        method: 'POST',
        body: JSON.stringify({ code: generated.code }),
      })
      const redeemed = (await redeemResp.json()) as { device: { id: string }; token: string }
      expect(redeemResp.status).toBe(200)
      expect(redeemed.token).toMatch(/^[A-Za-z0-9_-]{32,}$/)

      const dashboard = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/dashboard`,
        { headers: { authorization: `Bearer ${redeemed.token}`, host: '192.168.1.44:4010' } }
      )
      expect(dashboard.status).toBe(200)
      const dashBody = (await dashboard.json()) as { workspace: { id: string } }
      expect(dashBody.workspace.id).toBe(workspace.id)
    } finally {
      await server.close()
    }
  })

  test('redeemed code cannot be reused', async () => {
    const server = await startTestServer()
    tempDirs.push(server.dataDir)
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const { body: generated } = await generateCode(server.baseUrl, cookie)
      const first = await redeemCode(server.baseUrl, generated.code)
      expect(first.status).toBe(200)

      const second = await redeemCode(server.baseUrl, generated.code)
      expect(second.status).toBe(400)
      expect(second.body).toContain('already redeemed')
    } finally {
      await server.close()
    }
  })

  test('wrong code returns error', async () => {
    const server = await startTestServer()
    tempDirs.push(server.dataDir)
    try {
      const { status, body } = await redeemCode(server.baseUrl, '000000')
      expect(status).toBe(400)
      expect(body).toContain('Invalid')
    } finally {
      await server.close()
    }
  })

  test('pair/generate rejects non-localhost origin', async () => {
    const server = await startTestServer()
    tempDirs.push(server.dataDir)
    try {
      const response = await fetch(`${server.baseUrl}/api/mobile/pair/generate`, {
        headers: { origin: 'http://192.168.1.44:4010', 'content-type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({ capabilities: ['read_dashboard'], device_name: 'Remote' }),
      })
      expect(response.status).toBe(403)
    } finally {
      await server.close()
    }
  })
})

describe('mobile capability and workspace isolation', () => {
  test('read_dashboard device cannot dispatch (403)', async () => {
    const server = await startTestServer()
    tempDirs.push(server.dataDir)
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-cap-'))
    tempDirs.push(workspacePath)
    mkdirSync(join(workspacePath, '.hive'), { recursive: true })
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const workspace = createWorkspace(server.store, workspacePath, 'Cap Test')
      const worker = server.store.listWorkers(workspace.id)[0]

      const { body: generated } = await generateCode(server.baseUrl, cookie, ['read_dashboard'])
      const redeemResp = await fetch(`${server.baseUrl}/api/mobile/pair/redeem`, {
        headers: jsonHeaders(),
        method: 'POST',
        body: JSON.stringify({ code: generated.code }),
      })
      const redeemed = (await redeemResp.json()) as { token: string }

      const dispatch = await fetch(
        `${server.baseUrl}/api/mobile/workspaces/${workspace.id}/dispatch`,
        {
          headers: jsonHeaders({ host: '192.168.1.44:4010', token: redeemed.token }),
          method: 'POST',
          body: JSON.stringify({ task: 'Try dispatch', worker_id: worker?.id }),
        }
      )
      expect(dispatch.status).toBe(403)
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

      const { body: generated } = await generateCode(server.baseUrl, cookie, ['read_dashboard'])
      const redeemResp = await fetch(`${server.baseUrl}/api/mobile/pair/redeem`, {
        headers: jsonHeaders(),
        method: 'POST',
        body: JSON.stringify({ code: generated.code }),
      })
      const redeemed = (await redeemResp.json()) as { token: string }

      const dashWs1 = await fetch(`${server.baseUrl}/api/mobile/workspaces/${ws1.id}/dashboard`, {
        headers: { authorization: `Bearer ${redeemed.token}`, host: '192.168.1.44:4010' },
      })
      expect(dashWs1.status).toBe(200)
    } finally {
      await server.close()
    }
  })
})

describe('mobile device revocation', () => {
  test('revoked device token returns 410 on any endpoint', async () => {
    const server = await startTestServer()
    tempDirs.push(server.dataDir)
    try {
      const cookie = await getUiCookie(server.baseUrl)
      const { body: generated } = await generateCode(server.baseUrl, cookie)
      const redeemResp = await fetch(`${server.baseUrl}/api/mobile/pair/redeem`, {
        headers: jsonHeaders(),
        method: 'POST',
        body: JSON.stringify({ code: generated.code }),
      })
      const redeemed = (await redeemResp.json()) as { device: { id: string }; token: string }

      const dashboard = await fetch(`${server.baseUrl}/api/mobile/workspaces`, {
        headers: { authorization: `Bearer ${redeemed.token}`, host: '192.168.1.44:4010' },
      })
      expect(dashboard.status).toBe(200)

      await fetch(`${server.baseUrl}/api/mobile/devices/${redeemed.device.id}`, {
        headers: jsonHeaders({ cookie }),
        method: 'DELETE',
      })

      const after = await fetch(`${server.baseUrl}/api/mobile/workspaces`, {
        headers: { authorization: `Bearer ${redeemed.token}`, host: '192.168.1.44:4010' },
      })
      expect(after.status).toBe(410)
    } finally {
      await server.close()
    }
  })
})
