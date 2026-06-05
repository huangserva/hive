import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, test, vi } from 'vitest'

import type { MobileChatMessageType } from '../../src/server/mobile-chat-store.js'
import { createWebRtcUpstreamAudioSink } from '../../src/server/webrtc-upstream-audio.js'

type FakeAudioSinkData = {
  bitsPerSample: number
  channelCount: number
  numberOfFrames: number
  sampleRate: number
  samples: Int16Array
}

class FakeAudioSink {
  static instances: FakeAudioSink[] = []
  ondata?: (data: FakeAudioSinkData) => void
  stopped = false

  constructor(readonly track: unknown) {
    FakeAudioSink.instances.push(this)
  }

  emit(data: FakeAudioSinkData) {
    this.ondata?.(data)
  }

  stop() {
    this.stopped = true
  }
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
    FakeAudioSink.instances = []
  })

  test('captures remote PCM frames with RTCAudioSink, writes wav, and injects a voice prompt', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    const store = createStore()
    const transcribedPaths: string[] = []
    const transcribedAudio: Buffer[] = []
    const sink = createWebRtcUpstreamAudioSink({
      createSttProvider: () => ({
        detect: async () => ({ command: 'fake-stt', provider: 'paraformer' }),
        transcribeAudioFile: async (audioPath) => {
          transcribedPaths.push(audioPath)
          transcribedAudio.push(readFileSync(audioPath))
          return { provider: 'paraformer', text: '让关羽汇报进度' }
        },
      }),
      fastVoiceReplyProvider: {
        generate: async () => 'HIVE_GLM_GATEKEEPER: escalate\n收到，我让主管处理。',
      },
      loadAudioSink: async () => FakeAudioSink,
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
    expect(FakeAudioSink.instances).toHaveLength(1)
    expect(FakeAudioSink.instances[0]?.track).toEqual({ kind: 'audio' })
    FakeAudioSink.instances[0]?.emit({
      bitsPerSample: 16,
      channelCount: 1,
      numberOfFrames: 3,
      sampleRate: 16_000,
      samples: new Int16Array([100, -100, 200]),
    })
    await session.close()

    expect(transcribedPaths).toHaveLength(1)
    expect(transcribedPaths[0]?.endsWith('/call-1.wav')).toBe(true)
    const wav = transcribedAudio[0] ?? Buffer.alloc(0)
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE')
    expect(FakeAudioSink.instances[0]?.stopped).toBe(true)
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
    expect(transcribedPaths[0] ? existsSync(transcribedPaths[0]) : true).toBe(false)
  })
})
