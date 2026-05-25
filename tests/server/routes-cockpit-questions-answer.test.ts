import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { createAgentManager } from '../../src/server/agent-manager.js'
import { createApp } from '../../src/server/app.js'
import { createRuntimeStore } from '../../src/server/runtime-store.js'

const servers: Array<{ close: () => void }> = []
const stores: Array<ReturnType<typeof createRuntimeStore>> = []
const tempDirs: string[] = []

afterEach(async () => {
  while (servers.length > 0) {
    servers.pop()?.close()
  }
  while (stores.length > 0) {
    await stores.pop()?.close()
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const QUESTIONS_CONTENT = `# Open Questions

### 🔴 high

- [ ] **Q1** How to handle retries?

### 🟢 low

- [ ] **Q2** Minor naming question?
`

const setupServer = async (questionsContent = QUESTIONS_CONTENT) => {
  const agentManager = createAgentManager()
  const store = createRuntimeStore({ agentManager })
  stores.push(store)
  const app = createApp({ store })

  await new Promise<void>((resolve) => {
    app.server.listen(0, '127.0.0.1', () => resolve())
  })
  servers.push(app.server)

  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('No port')
  const baseUrl = `http://127.0.0.1:${address.port}`

  const workspacePath = mkdtempSync(join(tmpdir(), 'hive-answer-route-'))
  tempDirs.push(workspacePath)
  mkdirSync(join(workspacePath, '.hive'), { recursive: true })
  writeFileSync(join(workspacePath, '.hive', 'open-questions.md'), questionsContent, 'utf8')

  const workspace = store.createWorkspace(workspacePath, 'Answer Test')
  const uiToken = store.getUiToken()
  const cookie = `hive_ui_token=${uiToken}`

  return { baseUrl, cookie, store, workspace, workspacePath }
}

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

const postAnswer = async (url: string, cookie: string, body: Record<string, unknown>) => {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', cookie },
    method: 'POST',
  })
  return { body: await response.text(), status: response.status }
}

describe('POST /api/workspaces/:wsId/cockpit/questions/:qId/answer', () => {
  test('happy path — answers Q1 and writes to open-questions.md', async () => {
    const { baseUrl, cookie, workspacePath, workspace } = await setupServer()
    const { status } = await postAnswer(
      `${baseUrl}/api/workspaces/${workspace.id}/cockpit/questions/Q1/answer`,
      cookie,
      { answer: 'Use exponential backoff' }
    )

    expect(status).toBe(200)

    const updated = readFileSync(join(workspacePath, '.hive', 'open-questions.md'), 'utf8')
    expect(updated).toContain('Use exponential backoff')
  })

  test('happy path — nudges the active orchestrator PTY after persisting an answer', async () => {
    const { baseUrl, cookie, store, workspace, workspacePath } = await setupServer()
    const orchestratorId = `${workspace.id}:orchestrator`
    const orchScript = join(workspacePath, 'orch-echo.js')
    writeFileSync(
      orchScript,
      [
        "process.stdin.setEncoding('utf8')",
        "process.stdin.on('data', (chunk) => {",
        "  process.stdout.write('ORCH:' + chunk)",
        '})',
      ].join('\n')
    )
    store.configureAgentLaunch(workspace.id, orchestratorId, {
      command: '/bin/bash',
      args: ['-lc', `"${process.execPath}" "${orchScript}"`],
    })
    const run = await store.startAgent(workspace.id, orchestratorId, { hivePort: '4010' })

    const { status } = await postAnswer(
      `${baseUrl}/api/workspaces/${workspace.id}/cockpit/questions/Q1/answer`,
      cookie,
      { answer: 'Use exponential backoff before retrying' }
    )

    expect(status).toBe(200)
    await waitFor(() => {
      const activeRun = store.getLiveRun(run.runId)
      expect(activeRun.output).toContain('ORCH:[Hive 系统消息：PM question 已被 user 答复]')
      expect(activeRun.output).toContain('question_id: Q1')
      expect(activeRun.output).toContain('Use exponential backoff before retrying')
      expect(activeRun.output).toContain('请重读 .hive/open-questions.md')
    })
  })

  test('returns 400 when answer is missing', async () => {
    const { baseUrl, cookie, workspace } = await setupServer()
    const { status } = await postAnswer(
      `${baseUrl}/api/workspaces/${workspace.id}/cockpit/questions/Q1/answer`,
      cookie,
      {}
    )
    expect([400, 500]).toContain(status)
  })

  test('returns error when question does not exist', async () => {
    const { baseUrl, cookie, workspace } = await setupServer()
    const { status } = await postAnswer(
      `${baseUrl}/api/workspaces/${workspace.id}/cockpit/questions/NONEXISTENT/answer`,
      cookie,
      { answer: 'Something' }
    )
    expect([404, 500]).toContain(status)
  })

  test('returns 403 without valid UI token', async () => {
    const { baseUrl, workspace } = await setupServer()
    const { status } = await postAnswer(
      `${baseUrl}/api/workspaces/${workspace.id}/cockpit/questions/Q1/answer`,
      'hive_ui_token=invalid',
      { answer: 'Test' }
    )
    expect(status).toBe(403)
  })
})
