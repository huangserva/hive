import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, test, vi } from 'vitest'

import type { MobileChatMessageType } from '../../src/server/mobile-chat-store.js'
import { createWebRtcUpstreamAudioSink } from '../../src/server/webrtc-upstream-audio.js'

class FakeRecorder {
  static paths: string[] = []

  constructor(readonly input: { path: string; tracks: unknown[] }) {
    FakeRecorder.paths.push(input.path)
    const dir = input.path.slice(0, input.path.lastIndexOf('/'))
    mkdirSync(dir, { recursive: true })
    writeFileSync(input.path, Buffer.from('webm-audio'))
  }

  async stop() {}
}

const createStore = () => ({
  activeRun: {
    agentId: 'workspace-1:orchestrator',
    exitCode: null,
    output: '',
    pid: 123,
    runId: 'run-1',
    startedAt: 1,
    status: 'running' as const,
  },
  chat: [] as Array<{
    contentJson: string
    direction: 'inbound' | 'outbound'
    messageType: MobileChatMessageType
    workspaceId: string
  }>,
  inputs: [] as Array<{ options?: unknown; text: string; workspaceId: string; workerId: string }>,
  getActiveRunByAgentId(workspaceId: string, workerId: string) {
    expect(workspaceId).toBe('workspace-1')
    expect(workerId).toBe('workspace-1:orchestrator')
    return this.activeRun
  },
  insertMobileChatMessage(
    workspaceId: string,
    direction: 'inbound' | 'outbound',
    messageType: MobileChatMessageType,
    contentJson: string
  ) {
    this.chat.push({ contentJson, direction, messageType, workspaceId })
    return {
      content_json: contentJson,
      created_at: 1,
      direction,
      id: `message-${this.chat.length}`,
      message_type: messageType,
      workspace_id: workspaceId,
    }
  },
  listMobileChatMessages: () => [],
  listWorkers: () => [],
  recordUserInput(workspaceId: string, workerId: string, text: string, options?: unknown) {
    this.inputs.push({ options, text, workspaceId, workerId })
  },
})

describe('WebRTC upstream audio sink', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    FakeRecorder.paths = []
  })

  test('records remote audio to webm, transcribes it, and injects a voice prompt', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    const store = createStore()
    const transcribedPaths: string[] = []
    const sink = createWebRtcUpstreamAudioSink({
      createSttProvider: () => ({
        detect: async () => ({ command: 'fake-stt', provider: 'paraformer' }),
        transcribeAudioFile: async (audioPath) => {
          transcribedPaths.push(audioPath)
          return { provider: 'paraformer', text: '让关羽汇报进度' }
        },
      }),
      fastVoiceReplyProvider: {
        generate: async () => 'HIVE_GLM_GATEKEEPER: escalate\n收到，我让主管处理。',
      },
      loadMediaRecorder: async () => FakeRecorder,
      store,
      tempRoot: tmpdir(),
    })

    const session = await sink.start({
      callId: 'call-1',
      track: { kind: 'audio' },
      workspaceId: 'workspace-1',
    })
    expect(session).toBeDefined()
    if (!session) throw new Error('audio session was not created')
    await session.close()

    expect(transcribedPaths).toHaveLength(1)
    expect(transcribedPaths[0]?.endsWith('/call-1.webm')).toBe(true)
    expect(store.chat).toContainEqual({
      contentJson: JSON.stringify({ source: 'voice', text: '让关羽汇报进度' }),
      direction: 'inbound',
      messageType: 'user_text',
      workspaceId: 'workspace-1',
    })
    expect(store.inputs).toEqual([
      {
        options: undefined,
        text: '[来自手机 Mobile App]\n---\n让关羽汇报进度',
        workspaceId: 'workspace-1',
        workerId: 'workspace-1:orchestrator',
      },
    ])
    expect(FakeRecorder.paths[0] ? existsSync(FakeRecorder.paths[0]) : true).toBe(false)
  })
})
