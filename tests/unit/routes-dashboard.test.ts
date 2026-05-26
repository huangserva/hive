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

const setupServer = async () => {
  const agentManager = createAgentManager()
  const store = createRuntimeStore({ agentManager })
  const app = createApp({ store })

  await new Promise<void>((resolve) => {
    app.server.listen(0, '127.0.0.1', () => resolve())
  })
  servers.push(app.server)

  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('No port')
  const baseUrl = `http://127.0.0.1:${address.port}`

  return { baseUrl, store, uiToken: store.getUiToken() }
}

const uiHeaders = (token: string) => ({ cookie: `hive_ui_token=${token}` })

const fetchJson = async (url: string, init: RequestInit = {}) => {
  const response = await fetch(url, init)
  const body = (await response.json()) as unknown
  return { body, status: response.status }
}

describe('GET /api/ui/dashboard', () => {
  test('returns 403 when UI token is missing', async () => {
    const { baseUrl } = await setupServer()

    const { status } = await fetchJson(`${baseUrl}/api/ui/dashboard`)

    expect(status).toBe(403)
  })

  test('returns an empty dashboard when there are no workspaces', async () => {
    const { baseUrl, uiToken } = await setupServer()

    const { body, status } = await fetchJson(`${baseUrl}/api/ui/dashboard`, {
      headers: uiHeaders(uiToken),
    })

    expect(status).toBe(200)
    expect(body).toEqual([])
  })

  test('aggregates workspace worker counts and recent dispatch activity', async () => {
    const { baseUrl, store, uiToken } = await setupServer()
    const workspacePath = mkdtempSync(join(tmpdir(), 'hive-dashboard-route-'))
    tempDirs.push(workspacePath)
    const workspace = store.createWorkspace(workspacePath, 'Dashboard Test')
    const idleWorker = store.addWorker(workspace.id, {
      name: '关羽',
      role: 'coder',
    })
    const stoppedWorker = store.addWorker(workspace.id, {
      name: '张飞',
      role: 'tester',
    })
    store.getWorker(workspace.id, idleWorker.id).status = 'idle'
    const dispatch = await store.dispatchTask(workspace.id, idleWorker.id, 'M20a dashboard API')
    store.reportTask(workspace.id, idleWorker.id, {
      dispatchId: dispatch.id,
      text: 'done',
    })
    await store.dispatchTask(workspace.id, stoppedWorker.id, 'Keep this dispatch open')
    store.updateWorkerDescription(workspace.id, stoppedWorker.id, 'touch worker record')

    const { body, status } = await fetchJson(`${baseUrl}/api/ui/dashboard`, {
      headers: uiHeaders(uiToken),
    })

    expect(status).toBe(200)
    expect(body).toEqual([
      expect.objectContaining({
        activeWorkerCount: 1,
        cwd: workspacePath,
        id: workspace.id,
        name: 'Dashboard Test',
        openDispatchCount: 0,
        recentDispatchCount: 2,
        workerCount: 2,
      }),
    ])
    expect((body as Array<{ lastActivityAt: number | null }>)[0]?.lastActivityAt).toEqual(
      expect.any(Number)
    )
  })
})
