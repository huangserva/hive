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

const SLEEP_COMMAND = '/bin/bash'
const SLEEP_ARGS = ['-c', 'exec cat']

const postCancel = async (
  baseUrl: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
) => {
  const response = await fetch(`${baseUrl}/api/team/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return { body: (await response.json()) as Record<string, unknown>, status: response.status }
}

const setupCancelTest = async () => {
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

  const workspacePath = mkdtempSync(join(tmpdir(), 'hive-cancel-'))
  tempDirs.push(workspacePath)
  const workspace = store.createWorkspace(workspacePath, 'Cancel WS')

  const worker = store.addWorker(workspace.id, { name: 'Orch', role: 'orchestrator' })
  store.configureAgentLaunch(workspace.id, worker.id, {
    args: SLEEP_ARGS,
    command: SLEEP_COMMAND,
    commandPresetId: null,
  })
  await store.startAgent(workspace.id, worker.id, { hivePort: String(address.port) })
  const orchToken = store.peekAgentToken(worker.id)
  if (!orchToken) throw new Error('No orch token')

  const coder = store.addWorker(workspace.id, { name: 'Alice', role: 'coder' })
  store.configureAgentLaunch(workspace.id, coder.id, {
    args: SLEEP_ARGS,
    command: SLEEP_COMMAND,
    commandPresetId: null,
  })
  await store.startAgent(workspace.id, coder.id, { hivePort: String(address.port) })
  const coderToken = store.peekAgentToken(coder.id)
  if (!coderToken) throw new Error('No coder token')

  return { baseUrl, coder, coderToken, orch: worker, orchToken, store, workspace }
}

describe('POST /api/team/cancel', () => {
  test('returns 401 when agent token is missing', async () => {
    const { baseUrl, workspace } = await setupCancelTest()
    const { status, body } = await postCancel(baseUrl, {
      dispatch_id: 'abc',
      from_agent_id: 'agent-1',
      project_id: workspace.id,
      reason: 'bad',
    })
    expect(status).toBe(401)
    expect(body.error).toContain('Invalid or missing agent token')
  })

  test('returns 400 when from_agent_id is missing', async () => {
    const { baseUrl, orchToken, workspace } = await setupCancelTest()
    const { status, body } = await postCancel(baseUrl, {
      dispatch_id: 'abc',
      project_id: workspace.id,
      reason: 'bad',
      token: orchToken,
    })
    expect(status).toBe(400)
    expect(body.error).toContain('Missing from_agent_id')
  })

  test('returns 400 when dispatch_id is missing', async () => {
    const { baseUrl, orch, orchToken, workspace } = await setupCancelTest()
    const { status, body } = await postCancel(baseUrl, {
      from_agent_id: orch.id,
      project_id: workspace.id,
      reason: 'bad',
      token: orchToken,
    })
    expect(status).toBe(400)
    expect(body.error).toContain('Missing dispatch_id')
  })

  test('returns 400 when reason is missing', async () => {
    const { baseUrl, orch, orchToken, workspace } = await setupCancelTest()
    const { status, body } = await postCancel(baseUrl, {
      dispatch_id: 'abc',
      from_agent_id: orch.id,
      project_id: workspace.id,
      token: orchToken,
    })
    expect(status).toBe(400)
    expect(body.error).toContain('Missing reason')
  })

  test('returns 403 when worker token tries to cancel', async () => {
    const { baseUrl, coder, coderToken, workspace } = await setupCancelTest()
    const { status, body } = await postCancel(baseUrl, {
      dispatch_id: 'abc',
      from_agent_id: coder.id,
      project_id: workspace.id,
      reason: 'oops',
      token: coderToken,
    })
    expect(status).toBe(403)
    expect(body.error).toContain('not allowed to run team cancel')
  })

  test('returns 409 when dispatch_id does not exist', async () => {
    const { baseUrl, orch, orchToken, workspace } = await setupCancelTest()
    const { status, body } = await postCancel(baseUrl, {
      dispatch_id: 'nonexistent-dispatch-id',
      from_agent_id: orch.id,
      project_id: workspace.id,
      reason: 'abort',
      token: orchToken,
    })
    expect(status).toBe(409)
    expect(body.error).toContain('No open dispatch')
  })

  test('returns 202 with forwarded true on happy path with active worker', async () => {
    const { baseUrl, coder, orch, orchToken, store, workspace } = await setupCancelTest()

    const dispatch = await store.dispatchTask(workspace.id, coder.id, 'do work')
    const dispatchId = dispatch.id

    const { status, body } = await postCancel(baseUrl, {
      dispatch_id: dispatchId,
      from_agent_id: orch.id,
      project_id: workspace.id,
      reason: 'wrong direction',
      token: orchToken,
    })
    expect(status).toBe(202)
    expect(body.dispatch_id).toBe(dispatchId)
    expect(body.ok).toBe(true)
    expect(body.forwarded).toBe(true)
    expect(body.forward_error).toBeNull()
  })

  test('returns 202 and marks dispatch cancelled even when worker is stopped', async () => {
    const { baseUrl, coder, orch, orchToken, store, workspace } = await setupCancelTest()

    const coderRun = store.getActiveRunByAgentId(workspace.id, coder.id)
    if (coderRun) store.stopAgentRun(coderRun.runId)

    const dispatch = await store.dispatchTask(workspace.id, coder.id, 'do work')

    const { status, body } = await postCancel(baseUrl, {
      dispatch_id: dispatch.id,
      from_agent_id: orch.id,
      project_id: workspace.id,
      reason: 'worker gone',
      token: orchToken,
    })
    expect(status).toBe(202)
    expect(body.dispatch_id).toBe(dispatch.id)
    expect(body.ok).toBe(true)
  })
})
