import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import type { MobileChatMessage } from '../../src/server/mobile-chat-store.js'
import { startTestServer } from '../helpers/test-server.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const createWorkspaceFixture = () => {
  const workspacePath = mkdtempSync(join(tmpdir(), 'hive-team-media-ws-'))
  tempDirs.push(workspacePath)
  mkdirSync(join(workspacePath, '.hive'), { recursive: true })
  return workspacePath
}

const setupOrchestrator = async (
  server: Awaited<ReturnType<typeof startTestServer>>,
  workspaceName: string
) => {
  const workspacePath = createWorkspaceFixture()
  const workspace = server.store.createWorkspace(workspacePath, workspaceName)
  const orchestratorId = `${workspace.id}:orchestrator`
  const orchScript = join(workspacePath, 'orch-idle.js')
  writeFileSync(orchScript, 'process.stdin.resume()\n', 'utf8')
  server.store.configureAgentLaunch(workspace.id, orchestratorId, {
    args: ['-lc', `"${process.execPath}" "${orchScript}"`],
    command: '/bin/bash',
  })
  await server.store.startAgent(workspace.id, orchestratorId, { hivePort: '4010' })
  const token = server.store.peekAgentToken(orchestratorId)
  if (!token) throw new Error('Expected orchestrator token after start')
  return { orchestratorId, token, workspace, workspacePath }
}

const writeFakeVideo = (workspacePath: string, filename = 'demo.mp4', size = 256) => {
  const sourcePath = join(workspacePath, filename)
  // Realistic-ish video payload — non-zero bytes so size assertions are meaningful;
  // contents irrelevant for the route which only copies + records metadata.
  writeFileSync(sourcePath, Buffer.alloc(size, 0xab))
  return sourcePath
}

describe('POST /api/team/mobile-send-media', () => {
  test('真集成：copy 落 uploads、写 outbound orch_reply 行、触发 chat_message listener', async () => {
    const server = await startTestServer()
    try {
      const { orchestratorId, token, workspace, workspacePath } = await setupOrchestrator(
        server,
        'Mobile Send Media'
      )
      const sourcePath = writeFakeVideo(workspacePath, 'demo.mp4', 1024)

      const pushed: Array<{ workspaceId: string; message: MobileChatMessage }> = []
      const dispose = server.store.registerMobileChatListener((workspaceId, message) =>
        pushed.push({ message, workspaceId })
      )

      try {
        const response = await fetch(`${server.baseUrl}/api/team/mobile-send-media`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            from_agent_id: orchestratorId,
            project_id: workspace.id,
            token,
            file: sourcePath,
            text: '主管发的视频',
          }),
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          ok: boolean
          message_id: string
          file_id: string
          filename: string
          mime_type: string
          size: number
          url: string
        }
        expect(body.ok).toBe(true)
        expect(body.filename).toBe('demo.mp4')
        expect(body.mime_type).toBe('video/mp4')
        expect(body.size).toBe(1024)
        expect(body.url).toBe(`/api/mobile/uploads/${body.file_id}.mp4`)
        expect(body.file_id).toMatch(/^[0-9a-f-]{36}$/u)
        expect(body.message_id).toBeTruthy()

        // 1) 真落盘到 uploads（拷贝出新文件不是 hard link 删了源还在）
        const uploadsPath = join(server.dataDir, 'uploads', `${body.file_id}.mp4`)
        expect(existsSync(uploadsPath)).toBe(true)
        expect(readFileSync(uploadsPath).length).toBe(1024)
        expect(existsSync(sourcePath)).toBe(true)

        // 2) sqlite mobile_chat_messages 真写入 outbound orch_reply 行
        const messages = server.store.listMobileChatMessages(workspace.id)
        const outboundMedia = messages.find(
          (m) => m.message_type === 'orch_reply' && m.direction === 'outbound'
        )
        if (!outboundMedia) throw new Error('outbound orch_reply media row missing')
        expect(outboundMedia.workspace_id).toBe(workspace.id)
        const parsed = JSON.parse(outboundMedia.content_json) as {
          media: { file_id: string; filename: string; mime_type: string; size: number; url: string }
          text: string
        }
        expect(parsed.media.file_id).toBe(body.file_id)
        expect(parsed.media.filename).toBe('demo.mp4')
        expect(parsed.media.mime_type).toBe('video/mp4')
        expect(parsed.media.size).toBe(1024)
        expect(parsed.media.url).toBe(body.url)
        expect(parsed.text).toBe('主管发的视频')

        // 3) 关键：chat listener 被触发——就是 app.ts:218 pushEvent('chat_message') 入口
        const pushedForWorkspace = pushed.filter((entry) => entry.workspaceId === workspace.id)
        expect(pushedForWorkspace).toHaveLength(1)
        expect(pushedForWorkspace[0]?.message.message_type).toBe('orch_reply')
        expect(pushedForWorkspace[0]?.message.id).toBe(outboundMedia.id)
      } finally {
        dispose()
      }
    } finally {
      await server.close()
    }
  })

  test('未带 caption 时 text 默认 [filename] 占位', async () => {
    const server = await startTestServer()
    try {
      const { orchestratorId, token, workspace, workspacePath } = await setupOrchestrator(
        server,
        'Mobile Send Media No Caption'
      )
      const sourcePath = writeFakeVideo(workspacePath, 'clip.mp4', 128)

      const response = await fetch(`${server.baseUrl}/api/team/mobile-send-media`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from_agent_id: orchestratorId,
          project_id: workspace.id,
          token,
          file: sourcePath,
        }),
      })
      expect(response.status).toBe(200)
      const messages = server.store.listMobileChatMessages(workspace.id)
      const row = messages.find((m) => m.message_type === 'orch_reply')
      const parsed = JSON.parse(row?.content_json ?? '{}') as { text: string }
      expect(parsed.text).toBe('[clip.mp4]')
    } finally {
      await server.close()
    }
  })

  test('mime 按扩展名推断：.mov→video/quicktime / .png→image/png / 未知→octet-stream', async () => {
    const server = await startTestServer()
    try {
      const { orchestratorId, token, workspace, workspacePath } = await setupOrchestrator(
        server,
        'Mobile Send Media Mime'
      )
      const cases = [
        { filename: 'clip.mov', expected: 'video/quicktime' },
        { filename: 'photo.png', expected: 'image/png' },
        { filename: 'thing.bin', expected: 'application/octet-stream' },
      ]
      for (const { filename, expected } of cases) {
        const sourcePath = writeFakeVideo(workspacePath, filename, 32)
        const response = await fetch(`${server.baseUrl}/api/team/mobile-send-media`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            from_agent_id: orchestratorId,
            project_id: workspace.id,
            token,
            file: sourcePath,
          }),
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as { mime_type: string }
        expect(body.mime_type).toBe(expected)
      }
    } finally {
      await server.close()
    }
  })

  test('源文件不存在 → 400 BadRequest（不落 message、不触发 push）', async () => {
    const server = await startTestServer()
    try {
      const { orchestratorId, token, workspace } = await setupOrchestrator(
        server,
        'Mobile Send Media Missing'
      )
      const pushed: Array<unknown> = []
      const dispose = server.store.registerMobileChatListener(() => pushed.push(1))

      try {
        const response = await fetch(`${server.baseUrl}/api/team/mobile-send-media`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            from_agent_id: orchestratorId,
            project_id: workspace.id,
            token,
            file: '/tmp/this-path-truly-should-not-exist-xyz.mp4',
          }),
        })
        expect(response.status).toBe(400)
        const messages = server.store.listMobileChatMessages(workspace.id)
        expect(messages.filter((m) => m.message_type === 'orch_reply')).toEqual([])
        expect(pushed).toEqual([])
      } finally {
        dispose()
      }
    } finally {
      await server.close()
    }
  })

  test('无 token 或错 token → 401 / 403，不落 message', async () => {
    const server = await startTestServer()
    try {
      const { orchestratorId, workspace, workspacePath } = await setupOrchestrator(
        server,
        'Mobile Send Media Authz'
      )
      const sourcePath = writeFakeVideo(workspacePath, 'authz.mp4', 16)

      const bad = await fetch(`${server.baseUrl}/api/team/mobile-send-media`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from_agent_id: orchestratorId,
          project_id: workspace.id,
          token: 'totally-wrong-token',
          file: sourcePath,
        }),
      })
      expect(bad.status).toBeGreaterThanOrEqual(400)
      expect(bad.status).toBeLessThan(500)

      const messages = server.store.listMobileChatMessages(workspace.id)
      expect(messages.filter((m) => m.message_type === 'orch_reply')).toEqual([])
    } finally {
      await server.close()
    }
  })

  test('缺 --file 参数 → 400', async () => {
    const server = await startTestServer()
    try {
      const { orchestratorId, token, workspace } = await setupOrchestrator(
        server,
        'Mobile Send Media Missing Field'
      )
      const response = await fetch(`${server.baseUrl}/api/team/mobile-send-media`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from_agent_id: orchestratorId,
          project_id: workspace.id,
          token,
        }),
      })
      expect(response.status).toBe(400)
    } finally {
      await server.close()
    }
  })
})
