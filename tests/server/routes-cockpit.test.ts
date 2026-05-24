import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  const workspacePath = mkdtempSync(join(tmpdir(), 'hive-cockpit-route-'))
  tempDirs.push(workspacePath)
  const workspace = store.createWorkspace(workspacePath, 'Cockpit Test')
  const uiToken = store.getUiToken()

  return { baseUrl, store, uiToken, workspace }
}

const uiHeaders = (token: string) => ({ cookie: `hive_ui_token=${token}` })

const fetchJson = async (url: string, init: RequestInit = {}) => {
  const response = await fetch(url, init)
  const body = (await response.json()) as Record<string, unknown>
  return { body, status: response.status }
}

describe('GET /api/workspaces/:workspaceId/cockpit', () => {
  test('returns 403 when UI token is missing', async () => {
    const { baseUrl, workspace } = await setupServer()
    const { status } = await fetchJson(`${baseUrl}/api/workspaces/${workspace.id}/cockpit`)
    expect(status).toBe(403)
  })

  test('returns 403 when UI token is wrong', async () => {
    const { baseUrl, workspace } = await setupServer()
    const { status } = await fetchJson(`${baseUrl}/api/workspaces/${workspace.id}/cockpit`, {
      headers: { cookie: 'hive_ui_token=bad-token' },
    })
    expect(status).toBe(403)
  })

  test('returns parsed cockpit on 200 happy path', async () => {
    const { baseUrl, uiToken, workspace } = await setupServer()
    const { body, status } = await fetchJson(`${baseUrl}/api/workspaces/${workspace.id}/cockpit`, {
      headers: uiHeaders(uiToken),
    })
    expect(status).toBe(200)
    expect(body).toHaveProperty('plan')
    expect(body).toHaveProperty('questions')
    expect(body).toHaveProperty('ideas')
    expect(body).toHaveProperty('baseline')
    expect(body).toHaveProperty('decisions')
    expect(body).toHaveProperty('archive')
    expect(body).toHaveProperty('aiActions')
    expect(body).toHaveProperty('generatedAt')
  })

  test('returns 500 when workspace does not exist', async () => {
    const { baseUrl, uiToken } = await setupServer()
    const { status } = await fetchJson(`${baseUrl}/api/workspaces/nonexistent-id/cockpit`, {
      headers: uiHeaders(uiToken),
    })
    expect(status).toBe(500)
  })
})

describe('POST /api/workspaces/:workspaceId/cockpit/questions/:questionId/answer', () => {
  test('moves an open question to answered history and records the answer', async () => {
    const { baseUrl, uiToken, workspace } = await setupServer()
    const questionsPath = join(workspace.path, '.hive', 'open-questions.md')
    mkdirSync(join(workspace.path, '.hive'), { recursive: true })
    writeFileSync(
      questionsPath,
      `# Open Questions

## 待 user 拍板（按优先级）

### 🔴 high — 阻塞 ongoing 工作

- [ ] **Q3** 是否开启 mobile voice spike

### 🟠 medium — 影响下一步规划

（暂无）

### 🟢 low — 灰度区

（暂无）

## 已答（archive 留追溯）

（暂无）
`,
      'utf8'
    )

    const { body, status } = await fetchJson(
      `${baseUrl}/api/workspaces/${workspace.id}/cockpit/questions/Q3/answer`,
      {
        body: JSON.stringify({ answer: '先做最小 spike' }),
        headers: { ...uiHeaders(uiToken), 'content-type': 'application/json' },
        method: 'POST',
      }
    )

    expect(status).toBe(200)
    expect(body).toEqual({ ok: true })
    const nextContent = readFileSync(questionsPath, 'utf8')
    expect(nextContent).not.toContain('- [ ] **Q3**')
    expect(nextContent).toContain('- [x] **Q3** 是否开启 mobile voice spike → **answered ')
    expect(nextContent).toContain('**：先做最小 spike')
  })

  test('rejects empty answers', async () => {
    const { baseUrl, uiToken, workspace } = await setupServer()
    const { body, status } = await fetchJson(
      `${baseUrl}/api/workspaces/${workspace.id}/cockpit/questions/Q3/answer`,
      {
        body: JSON.stringify({ answer: '   ' }),
        headers: { ...uiHeaders(uiToken), 'content-type': 'application/json' },
        method: 'POST',
      }
    )

    expect(status).toBe(400)
    expect(body.error).toBe('answer must not be empty')
  })
})
