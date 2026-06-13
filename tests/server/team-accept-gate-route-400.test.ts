import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { startTestServer } from '../helpers/test-server.js'

// 钟馗审 High（同安全面）：/api/team/report 的 raw HTTP body 边界硬化。
// 任一 reviewer/verdict/verdict_reason 字段存在但组合非法时直接 400，
// 不再静默降级为普通 report（守 L1 API 边界，非 CLI 客户端也兜得住）。

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const setupCoderWorker = async (
  server: Awaited<ReturnType<typeof startTestServer>>,
  workspaceName: string
) => {
  const workspacePath = mkdtempSync(join(tmpdir(), 'hive-m43-route-ws-'))
  tempDirs.push(workspacePath)
  mkdirSync(join(workspacePath, '.hive'), { recursive: true })
  writeFileSync(
    join(workspacePath, '.hive', 'tasks.md'),
    '# Tasks\n\n## In progress\n\n## Done\n',
    'utf8'
  )
  const workspace = server.store.createWorkspace(workspacePath, workspaceName)
  const orchestratorId = `${workspace.id}:orchestrator`
  // 走 passive 脚本让 orch 起进入 idle，但不真处理 stdin。
  const passive = join(workspacePath, 'passive.js')
  writeFileSync(passive, 'process.stdin.resume()\n', 'utf8')
  server.store.configureAgentLaunch(workspace.id, orchestratorId, {
    args: ['-lc', `"${process.execPath}" "${passive}"`],
    command: '/bin/bash',
  })
  await server.store.startAgent(workspace.id, orchestratorId, { hivePort: '4010' })

  const coder = server.store.addWorker(workspace.id, { name: '关羽', role: 'coder' })
  server.store.configureAgentLaunch(workspace.id, coder.id, {
    args: ['-lc', `"${process.execPath}" "${passive}"`],
    command: '/bin/bash',
    commandPresetId: 'claude',
  })
  await server.store.startAgent(workspace.id, coder.id, { hivePort: '4010' })
  const token = server.store.peekAgentToken(coder.id)
  if (!token) throw new Error('Expected coder token after start')

  // 派单让 worker 有一条 open dispatch 可 report
  const dispatch = await server.store.dispatchTask(workspace.id, coder.id, '改 src/foo.ts')
  return { coder, dispatch, token, workspace }
}

describe('POST /api/team/report — M43 reviewer/verdict 字段组合校验 (route 400 硬化)', () => {
  test('reviews_dispatch_id 是空串 → 400', async () => {
    const server = await startTestServer()
    try {
      const { coder, dispatch, token, workspace } = await setupCoderWorker(server, 'm43-route-1')
      const res = await fetch(`${server.baseUrl}/api/team/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id: workspace.id,
          from_agent_id: coder.id,
          token,
          result: '改了 src/foo.ts',
          dispatch_id: dispatch.id,
          reviews_dispatch_id: '   ',
        }),
      })
      expect(res.status).toBe(400)
    } finally {
      await server.close()
    }
  })

  test('verdict 拼错 (verdict="ok") → 400（不再静默降级）', async () => {
    const server = await startTestServer()
    try {
      const { coder, dispatch, token, workspace } = await setupCoderWorker(server, 'm43-route-2')
      const res = await fetch(`${server.baseUrl}/api/team/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id: workspace.id,
          from_agent_id: coder.id,
          token,
          result: '改了 src/foo.ts',
          dispatch_id: dispatch.id,
          reviews_dispatch_id: 'some-id',
          verdict: 'ok',
          verdict_reason: '看过',
        }),
      })
      expect(res.status).toBe(400)
    } finally {
      await server.close()
    }
  })

  test('verdict_reason 空串 → 400', async () => {
    const server = await startTestServer()
    try {
      const { coder, dispatch, token, workspace } = await setupCoderWorker(server, 'm43-route-3')
      const res = await fetch(`${server.baseUrl}/api/team/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id: workspace.id,
          from_agent_id: coder.id,
          token,
          result: '改了 src/foo.ts',
          dispatch_id: dispatch.id,
          reviews_dispatch_id: 'some-id',
          verdict: 'accepted',
          verdict_reason: '   ',
        }),
      })
      expect(res.status).toBe(400)
    } finally {
      await server.close()
    }
  })

  test('reviews_dispatch_id 单独存在但 verdict 缺 → 400（必须配对）', async () => {
    const server = await startTestServer()
    try {
      const { coder, dispatch, token, workspace } = await setupCoderWorker(server, 'm43-route-4')
      const res = await fetch(`${server.baseUrl}/api/team/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id: workspace.id,
          from_agent_id: coder.id,
          token,
          result: '改了 src/foo.ts',
          dispatch_id: dispatch.id,
          reviews_dispatch_id: 'some-id',
        }),
      })
      expect(res.status).toBe(400)
    } finally {
      await server.close()
    }
  })

  test('verdict 单独存在但 reviews_dispatch_id 缺 → 400（必须配对）', async () => {
    const server = await startTestServer()
    try {
      const { coder, dispatch, token, workspace } = await setupCoderWorker(server, 'm43-route-5')
      const res = await fetch(`${server.baseUrl}/api/team/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id: workspace.id,
          from_agent_id: coder.id,
          token,
          result: '改了 src/foo.ts',
          dispatch_id: dispatch.id,
          verdict: 'accepted',
          verdict_reason: '看过',
        }),
      })
      expect(res.status).toBe(400)
    } finally {
      await server.close()
    }
  })

  test('只传 verdict_reason 单字段（缺 reviews_dispatch_id + verdict）→ 400（钟馗第二轮 blocking #2）', async () => {
    const server = await startTestServer()
    try {
      const { coder, dispatch, token, workspace } = await setupCoderWorker(
        server,
        'm43-route-v-reason-only'
      )
      const res = await fetch(`${server.baseUrl}/api/team/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id: workspace.id,
          from_agent_id: coder.id,
          token,
          result: '改了 src/foo.ts',
          dispatch_id: dispatch.id,
          verdict_reason: '我看过',
        }),
      })
      expect(res.status).toBe(400)
    } finally {
      await server.close()
    }
  })

  test('只传 verdict_reason 空串（已经空但字段存在）→ 400（不静默降级）', async () => {
    const server = await startTestServer()
    try {
      const { coder, dispatch, token, workspace } = await setupCoderWorker(
        server,
        'm43-route-v-reason-empty'
      )
      const res = await fetch(`${server.baseUrl}/api/team/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id: workspace.id,
          from_agent_id: coder.id,
          token,
          result: '改了 src/foo.ts',
          dispatch_id: dispatch.id,
          verdict_reason: '   ',
        }),
      })
      expect(res.status).toBe(400)
    } finally {
      await server.close()
    }
  })

  test('没传 reviewer/verdict 字段 → 走普通 report 路径不挂红（向后兼容）', async () => {
    const server = await startTestServer()
    try {
      const { coder, dispatch, token, workspace } = await setupCoderWorker(server, 'm43-route-6')
      const res = await fetch(`${server.baseUrl}/api/team/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id: workspace.id,
          from_agent_id: coder.id,
          token,
          result: '改了 src/foo.ts',
          dispatch_id: dispatch.id,
        }),
      })
      // 202 是 reportTask 成功后 routes-team 返的 status；这条断言守住"普通 report 路径不受 reviewer 校验副作用"。
      expect(res.status).toBe(202)
    } finally {
      await server.close()
    }
  })
})
