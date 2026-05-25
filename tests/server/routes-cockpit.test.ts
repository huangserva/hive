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

const fetchText = async (url: string, init: RequestInit = {}) => {
  const response = await fetch(url, init)
  const body = await response.text()
  return { body, contentType: response.headers.get('content-type'), status: response.status }
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

describe('POST /api/workspaces/:workspaceId/cockpit/ideas/:ideaId/promote', () => {
  test('moves an inbox idea to promoted and creates an open question by default', async () => {
    const { baseUrl, uiToken, workspace } = await setupServer()
    const hiveDir = join(workspace.path, '.hive')
    const ideasPath = join(hiveDir, 'ideas', 'inbox.md')
    const questionsPath = join(hiveDir, 'open-questions.md')
    mkdirSync(join(hiveDir, 'ideas'), { recursive: true })
    writeFileSync(
      ideasPath,
      `# Ideas Inbox

## inbox（按加入时间倒序）

### 2026-05-24

- 🤔 idea: add voice mode

## promoted

（暂无）
`,
      'utf8'
    )
    writeFileSync(
      questionsPath,
      `# Open Questions

## 待 user 拍板（按优先级）

### 🔴 high — 阻塞 ongoing 工作

（暂无）

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
      `${baseUrl}/api/workspaces/${workspace.id}/cockpit/ideas/I1/promote`,
      {
        body: JSON.stringify({ target: 'question' }),
        headers: { ...uiHeaders(uiToken), 'content-type': 'application/json' },
        method: 'POST',
      }
    )

    expect(status).toBe(200)
    expect(body).toEqual({ ok: true })
    const nextIdeas = readFileSync(ideasPath, 'utf8')
    expect(nextIdeas).not.toContain('- 🤔 idea: add voice mode')
    expect(nextIdeas).toContain('- ~~add voice mode~~ → promoted to question')
    const nextQuestions = readFileSync(questionsPath, 'utf8')
    expect(nextQuestions).toContain('**Q1** 是否将 idea 提升为 question：add voice mode')
  })
})

describe('POST /api/workspaces/:workspaceId/cockpit/decisions/:decisionId/confirm', () => {
  test('renames a draft ADR to adopted and updates its status', async () => {
    const { baseUrl, uiToken, workspace } = await setupServer()
    const decisionsDir = join(workspace.path, '.hive', 'decisions')
    mkdirSync(decisionsDir, { recursive: true })
    const draftPath = join(decisionsDir, 'draft-2026-05-24-test-decision.md')
    writeFileSync(
      draftPath,
      `# 决策：Test Decision

**日期**: 2026-05-24
**状态**: 提案中
`,
      'utf8'
    )

    const { body, status } = await fetchJson(
      `${baseUrl}/api/workspaces/${workspace.id}/cockpit/decisions/draft-2026-05-24-test-decision.md/confirm`,
      {
        body: JSON.stringify({}),
        headers: { ...uiHeaders(uiToken), 'content-type': 'application/json' },
        method: 'POST',
      }
    )

    expect(status).toBe(200)
    expect(body).toEqual({ ok: true, filename: '2026-05-24-test-decision.md' })
    expect(() => readFileSync(draftPath, 'utf8')).toThrow()
    const adopted = readFileSync(join(decisionsDir, '2026-05-24-test-decision.md'), 'utf8')
    expect(adopted).toContain('**状态**: 已采纳')
    expect(adopted).toContain('**确认日期**:')
  })
})

describe('POST /api/workspaces/:workspaceId/open-file', () => {
  test('rejects paths outside the workspace before invoking the opener', async () => {
    const { baseUrl, uiToken, workspace } = await setupServer()

    const { body, status } = await fetchJson(
      `${baseUrl}/api/workspaces/${workspace.id}/open-file`,
      {
        body: JSON.stringify({ path: '/tmp/outside-hippoteam-open-file.md' }),
        headers: { ...uiHeaders(uiToken), 'content-type': 'application/json' },
        method: 'POST',
      }
    )

    expect(status).toBe(400)
    expect(body.error).toBe('path must be inside workspace')
  })
})

describe('GET /api/workspaces/:workspaceId/cockpit/report-file', () => {
  test('serves report html inside .hive/reports', async () => {
    const { baseUrl, uiToken, workspace } = await setupServer()
    const reportsDir = join(workspace.path, '.hive', 'reports')
    mkdirSync(reportsDir, { recursive: true })
    writeFileSync(
      join(reportsDir, '2026-05-25-cockpit-report.html'),
      '<!doctype html><title>Cockpit Report</title><h1>OK</h1>',
      'utf8'
    )

    const { body, contentType, status } = await fetchText(
      `${baseUrl}/api/workspaces/${workspace.id}/cockpit/report-file?path=${encodeURIComponent(
        '.hive/reports/2026-05-25-cockpit-report.html'
      )}`,
      { headers: uiHeaders(uiToken) }
    )

    expect(status).toBe(200)
    expect(contentType).toContain('text/html')
    expect(body).toContain('<h1>OK</h1>')
  })

  test('rejects path traversal outside .hive/reports', async () => {
    const { baseUrl, uiToken, workspace } = await setupServer()

    const { body, status } = await fetchJson(
      `${baseUrl}/api/workspaces/${workspace.id}/cockpit/report-file?path=${encodeURIComponent(
        '.hive/reports/../escaped.html'
      )}`,
      { headers: uiHeaders(uiToken) }
    )

    expect(status).toBe(400)
    expect(body.error).toBe('report path must stay inside .hive/reports')
  })

  test('rejects non-html report paths', async () => {
    const { baseUrl, uiToken, workspace } = await setupServer()

    const { body, status } = await fetchJson(
      `${baseUrl}/api/workspaces/${workspace.id}/cockpit/report-file?path=${encodeURIComponent(
        '.hive/reports/report.md'
      )}`,
      { headers: uiHeaders(uiToken) }
    )

    expect(status).toBe(400)
    expect(body.error).toBe('report path must be an .html file')
  })

  test('returns 404 when report file does not exist', async () => {
    const { baseUrl, uiToken, workspace } = await setupServer()

    const { body, status } = await fetchJson(
      `${baseUrl}/api/workspaces/${workspace.id}/cockpit/report-file?path=${encodeURIComponent(
        '.hive/reports/missing.html'
      )}`,
      { headers: uiHeaders(uiToken) }
    )

    expect(status).toBe(404)
    expect(body.error).toBe('Report not found: .hive/reports/missing.html')
  })
})
