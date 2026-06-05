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

const emitFrame = (sink: FakeAudioSink | undefined, value: number, samples = 160) => {
  sink?.emit({
    bitsPerSample: 16,
    channelCount: 1,
    numberOfFrames: samples,
    sampleRate: 16_000,
    samples: new Int16Array(samples).fill(value),
  })
}

describe('WebRTC upstream audio sink', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    FakeAudioSink.instances = []
  })

  test('captures remote PCM frames with RTCAudioSink, writes wav, and injects a voice prompt', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    const store = createStore()
    const infoLogs: string[] = []
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
      logger: {
        info: (message) => infoLogs.push(message),
        warn: () => {},
      },
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
      numberOfFrames: 4000,
      sampleRate: 16_000,
      samples: new Int16Array(4000).fill(5000),
    })
    await session.close()

    expect(transcribedPaths).toHaveLength(1)
    expect(transcribedPaths[0]?.endsWith('/call-1-utterance-1.wav')).toBe(true)
    const wav = transcribedAudio[0] ?? Buffer.alloc(0)
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE')
    expect(FakeAudioSink.instances[0]?.stopped).toBe(true)
    expect(infoLogs).toEqual(
      expect.arrayContaining([
        expect.stringContaining('audioSink started: call_id=call-1'),
        expect.stringContaining(
          'audioSink first frame: call_id=call-1 chunks=1 pcm_frames=4000 sample_rate=16000 bits=16 channels=1'
        ),
        expect.stringContaining(
          'audioSink closing: call_id=call-1 chunks=1 pcm_frames=4000 sample_rate=16000 bits=16 channels=1'
        ),
      ])
    )
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

  test('segments live PCM into utterances and injects each transcript before the call closes', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    const store = createStore()
    const warnings: unknown[] = []
    const transcribedAudio: Buffer[] = []
    const transcribedPaths: string[] = []
    const sink = createWebRtcUpstreamAudioSink({
      createSttProvider: () => ({
        detect: async () => ({ command: 'fake-stt', provider: 'paraformer' }),
        transcribeAudioFile: async (audioPath) => {
          transcribedPaths.push(audioPath)
          transcribedAudio.push(readFileSync(audioPath))
          return { provider: 'paraformer', text: `utterance ${transcribedAudio.length}` }
        },
      }),
      fastVoiceReplyProvider: {
        generate: async () => 'HIVE_GLM_GATEKEEPER: escalate\n收到，我让主管处理。',
      },
      loadAudioSink: async () => FakeAudioSink,
      logger: {
        info: () => {},
        warn: (...args) => warnings.push(args),
      },
      store,
      tempRoot: tmpdir(),
      vad: {
        minSpeechMs: 20,
        silenceMs: 40,
        speechRmsThreshold: 0.02,
      },
    })

    const session = await sink.start({
      callId: 'call-live',
      track: { kind: 'audio' },
      workspaceId: 'workspace-1',
    })
    const audioSink = FakeAudioSink.instances[0]
    for (let index = 0; index < 3; index += 1) emitFrame(audioSink, 5000)
    for (let index = 0; index < 4; index += 1) emitFrame(audioSink, 0)
    await vi.waitFor(() => expect(store.inputs).toHaveLength(1), { timeout: 1000 })
    for (let index = 0; index < 2; index += 1) emitFrame(audioSink, 5000)
    for (let index = 0; index < 4; index += 1) emitFrame(audioSink, 0)
    await vi.waitFor(() => expect(store.inputs).toHaveLength(2), { timeout: 1000 })

    expect(warnings).toEqual([])

    expect(transcribedAudio).toHaveLength(2)
    expect(transcribedPaths).toHaveLength(2)
    expect(transcribedPaths.every((path) => !existsSync(path))).toBe(true)
    expect(store.inputs.map((input) => input.text)).toEqual([
      '[来自手机 Mobile App]\n---\nutterance 1',
      '[来自手机 Mobile App]\n---\nutterance 2',
    ])

    await session.close()
    expect(store.inputs).toHaveLength(2)
  })

  test('does not transcribe a short trailing noise burst when the call closes', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    const store = createStore()
    const transcribedPaths: string[] = []
    const sink = createWebRtcUpstreamAudioSink({
      createSttProvider: () => ({
        detect: async () => ({ command: 'fake-stt', provider: 'paraformer' }),
        transcribeAudioFile: async (audioPath) => {
          transcribedPaths.push(audioPath)
          return { provider: 'paraformer', text: 'noise' }
        },
      }),
      fastVoiceReplyProvider: {
        generate: async () => 'HIVE_GLM_GATEKEEPER: escalate\n收到，我让主管处理。',
      },
      loadAudioSink: async () => FakeAudioSink,
      logger: {
        info: () => {},
        warn: () => {},
      },
      store,
      tempRoot: tmpdir(),
      vad: {
        minSpeechMs: 30,
        silenceMs: 100,
        speechRmsThreshold: 0.02,
      },
    })

    const session = await sink.start({
      callId: 'call-noise',
      track: { kind: 'audio' },
      workspaceId: 'workspace-1',
    })
    emitFrame(FakeAudioSink.instances[0], 5000)

    await session.close()

    expect(transcribedPaths).toEqual([])
    expect(store.inputs).toEqual([])
  })
})
