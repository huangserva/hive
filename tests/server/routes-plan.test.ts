import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { createAgentManager } from '../../src/server/agent-manager.js'
import { createApp } from '../../src/server/app.js'
import { createRuntimeStore } from '../../src/server/runtime-store.js'
import { createTasksFileService } from '../../src/server/tasks-file.js'

const servers: Array<{ close: () => void }> = []
const tempDirs: string[] = []

afterEach(() => {
  while (servers.length > 0) {
    servers.pop()?.close()
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const PLAN_CONTENT = `---
title: Test Project
status: active
---

## 目标

Ship the feature.

## 里程碑

### M1 · shipped 2026-01-01

- [x] Done item

## Scope

- in: Core
- out: Extras

## 已知 risk

- Risk A

## 当前 phase

M1`

const setupServer = async (planContent?: string) => {
  const agentManager = createAgentManager()
  const store = createRuntimeStore({ agentManager })

  const workspacePath = mkdtempSync(join(tmpdir(), 'hive-plan-route-'))
  tempDirs.push(workspacePath)
  mkdirSync(join(workspacePath, '.hive'), { recursive: true })
  if (planContent !== undefined) {
    writeFileSync(join(workspacePath, '.hive', 'plan.md'), planContent, 'utf8')
  }

  const tasksFileService = createTasksFileService()
  const app = createApp({ store, tasksFileService })

  await new Promise<void>((resolve) => {
    app.server.listen(0, '127.0.0.1', () => resolve())
  })
  servers.push(app.server)

  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('No port')
  const baseUrl = `http://127.0.0.1:${address.port}`

  const workspace = store.createWorkspace(workspacePath, 'Plan Test')
  const uiToken = store.getUiToken()

  return { baseUrl, store, uiToken, workspace, workspacePath }
}

const uiHeaders = (token: string) => ({ cookie: `hive_ui_token=${token}` })

const fetchJson = async (url: string, init: RequestInit = {}) => {
  const response = await fetch(url, init)
  const body = (await response.json()) as Record<string, unknown>
  return { body, status: response.status }
}

describe('GET /api/workspaces/:workspaceId/plan', () => {
  test('returns 403 when UI token is missing', async () => {
    const { baseUrl, workspace } = await setupServer(PLAN_CONTENT)
    const { status } = await fetchJson(`${baseUrl}/api/workspaces/${workspace.id}/plan`)
    expect(status).toBe(403)
  })

  test('returns 403 when UI token is wrong', async () => {
    const { baseUrl, workspace } = await setupServer(PLAN_CONTENT)
    const { status } = await fetchJson(`${baseUrl}/api/workspaces/${workspace.id}/plan`, {
      headers: uiHeaders('bad-token'),
    })
    expect(status).toBe(403)
  })

  test('returns parsed plan on 200 happy path', async () => {
    const { baseUrl, uiToken, workspace } = await setupServer(PLAN_CONTENT)
    const { body, status } = await fetchJson(`${baseUrl}/api/workspaces/${workspace.id}/plan`, {
      headers: uiHeaders(uiToken),
    })
    expect(status).toBe(200)
    expect(body.frontmatter).toMatchObject({ status: 'active', title: 'Test Project' })
    expect(body.goal).toBe('Ship the feature.')
    expect(body.milestones).toHaveLength(1)
    expect((body.milestones as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: 'M1',
      status: 'shipped',
      date: '2026-01-01',
    })
    expect(body.scope).toEqual({ in: ['Core'], out: ['Extras'] })
    expect(body.risks).toEqual(['Risk A'])
    expect(body.currentPhase).toBe('M1')
    expect(body.parseError).toBeNull()
    expect(body.raw).toBe(PLAN_CONTENT)
  })

  test('returns plan with empty milestones when plan.md has no milestones', async () => {
    const { baseUrl, uiToken, workspace } = await setupServer(
      '---\ntitle: Empty\n---\n## 目标\n\nNo milestones here.\n'
    )
    const { body, status } = await fetchJson(`${baseUrl}/api/workspaces/${workspace.id}/plan`, {
      headers: uiHeaders(uiToken),
    })
    expect(status).toBe(200)
    expect(body.milestones).toEqual([])
    expect(body.goal).toBe('No milestones here.')
  })

  test('returns generated plan when plan.md does not exist yet', async () => {
    const { baseUrl, uiToken, workspace } = await setupServer(undefined)
    const { body, status } = await fetchJson(`${baseUrl}/api/workspaces/${workspace.id}/plan`, {
      headers: uiHeaders(uiToken),
    })
    expect(status).toBe(200)
    expect(body.raw).toBeTruthy()
    expect(body.frontmatter).toBeDefined()
  })

  test('returns 500 when workspace path is invalid (store throws)', async () => {
    const { baseUrl, uiToken } = await setupServer(PLAN_CONTENT)
    const { status } = await fetchJson(`${baseUrl}/api/workspaces/nonexistent-id/plan`, {
      headers: uiHeaders(uiToken),
    })
    expect(status).toBe(500)
  })
})
