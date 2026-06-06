import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, test, vi } from 'vitest'

import type { MobileChatMessageType } from '../../src/server/mobile-chat-store.js'
import {
  createWebRtcUpstreamAudioSink,
  injectWebRtcVoiceTranscript,
} from '../../src/server/webrtc-upstream-audio.js'

type FakeAudioSinkData = {
  bitsPerSample?: number
  channelCount?: number
  numberOfFrames?: number
  sampleRate?: number
  samples: Buffer | Int16Array | number[]
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
      createStreamingRecognitionSession: async () => null,
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
          'audioSink first frame: call_id=call-1 chunks=1 pcm_frames=4000 sample_rate=16000 bits=16 channels=1 rms_current='
        ),
        expect.stringContaining(
          'audioSink closing: call_id=call-1 chunks=1 pcm_frames=4000 sample_rate=16000 bits=16 channels=1'
        ),
        expect.stringContaining(
          'audioSink utterance ready: call_id=call-1 utterance=1 bytes=8000 sample_rate=16000 bits=16 channels=1 rms_avg='
        ),
        expect.stringContaining('rms_peak='),
      ])
    )
    expect(store.chat).toContainEqual({
      contentJson: JSON.stringify({ source: 'webrtc_call', text: '让关羽汇报进度' }),
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
      createStreamingRecognitionSession: async () => null,
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
    if (!session) throw new Error('audio session was not created')
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
      createStreamingRecognitionSession: async () => null,
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
    if (!session) throw new Error('audio session was not created')
    emitFrame(FakeAudioSink.instances[0], 5000)

    await session.close()

    expect(transcribedPaths).toEqual([])
    expect(store.inputs).toEqual([])
  })

  test('uses streaming STT when available and skips the batch VAD/WAV path', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    const store = createStore()
    let batchDetectCount = 0
    const pushedFrames: Array<{ bitsPerSample: number; pcmBuffer: Buffer; sampleRate: number }> = []
    let closedStreaming = false
    const sink = createWebRtcUpstreamAudioSink({
      createSttProvider: () => ({
        detect: async () => {
          batchDetectCount += 1
          return { command: 'fake-stt', provider: 'paraformer' }
        },
        transcribeAudioFile: async () => ({ provider: 'paraformer', text: 'batch' }),
      }),
      createStreamingRecognitionSession: async (_callId, options) => ({
        close: () => {
          closedStreaming = true
        },
        flush: async () => {
          await options.onFinal('第二句')
        },
        pushFrame: (pcmBuffer, sampleRate, bitsPerSample) => {
          pushedFrames.push({ bitsPerSample, pcmBuffer, sampleRate })
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
        minSpeechMs: 20,
        silenceMs: 40,
        speechRmsThreshold: 0.02,
      },
    })

    const session = await sink.start({
      callId: 'call-streaming',
      track: { kind: 'audio' },
      workspaceId: 'workspace-1',
    })
    if (!session) throw new Error('audio session was not created')
    emitFrame(FakeAudioSink.instances[0], 5000)
    await session.close()

    expect(pushedFrames).toHaveLength(1)
    expect(batchDetectCount).toBe(0)
    expect(closedStreaming).toBe(true)
    expect(store.inputs).toEqual([
      {
        options: undefined,
        text: '[来自手机 Mobile App]\n---\n第二句',
        workspaceId: 'workspace-1',
        workerId: 'workspace-1:orchestrator',
      },
    ])
  })

  test('does not create a voice intent shadow session when the feature flag is disabled', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '0')
    const store = createStore()
    const createVoiceIntentSession = vi.fn()
    let capturedOptions:
      | Parameters<
          NonNullable<
            Parameters<typeof createWebRtcUpstreamAudioSink>[0]['createStreamingRecognitionSession']
          >
        >[1]
      | undefined
    const sink = createWebRtcUpstreamAudioSink({
      createStreamingRecognitionSession: async (_callId, options) => {
        capturedOptions = options
        return {
          close: () => {},
          flush: async () => {
            await options.onFinal('让关羽汇报进度')
          },
          pushFrame: () => {},
        }
      },
      createVoiceIntentSession,
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
    })

    const session = await sink.start({
      callId: 'call-shadow-off',
      track: { kind: 'audio' },
      workspaceId: 'workspace-1',
    })
    if (!session) throw new Error('audio session was not created')

    if (!capturedOptions?.onPartial) throw new Error('streaming partial callback was not captured')
    await capturedOptions.onPartial('让关羽')
    await session.close()

    expect(createVoiceIntentSession).not.toHaveBeenCalled()
    expect(store.inputs).toHaveLength(1)
    expect(store.inputs[0]?.text).toBe('[来自手机 Mobile App]\n---\n让关羽汇报进度')
  })

  test('feeds streaming partial and final text into the voice intent shadow session and only logs verdicts', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    const store = createStore()
    const infoLogs: string[] = []
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce({
        candidate: {
          action: 'handled',
          completeness: 'likely_complete',
          confidence: 0.61,
          distilledIntent: '查询关羽进度',
          intentGeneration: 1,
          replyText: '我看一下。',
          shouldSpeculateTts: true,
          transcript: '让关羽',
        },
        status: 'accepted',
        verdict: {
          action: 'handled',
          completeness: 'likely_complete',
          confidence: 0.61,
          distilled_intent: '查询关羽进度',
          intent_generation: 1,
          reason: 'glm_verdict',
          reply_text: '我看一下。',
          should_speculate_tts: true,
        },
      })
      .mockResolvedValueOnce({
        candidate: {
          action: 'escalate',
          completeness: 'complete',
          confidence: 0.86,
          distilledIntent: '让关羽汇报进度',
          intentGeneration: 2,
          replyText: '好，这个交给主管。',
          shouldSpeculateTts: true,
          transcript: '让关羽汇报进度',
        },
        handoff: {
          confidence: 0.86,
          distilledIntent: '让关羽汇报进度',
          intentGeneration: 2,
          transcript: '让关羽汇报进度',
          turnId: 'call-shadow-on',
        },
        status: 'accepted',
        verdict: {
          action: 'escalate',
          completeness: 'complete',
          confidence: 0.86,
          distilled_intent: '让关羽汇报进度',
          intent_generation: 2,
          reason: 'glm_verdict',
          reply_text: '好，这个交给主管。',
          should_speculate_tts: true,
        },
      })
    const closeIntentSession = vi.fn()
    const createVoiceIntentSession = vi.fn(() => ({
      close: closeIntentSession,
      evaluate,
    }))
    let capturedOptions:
      | Parameters<
          NonNullable<
            Parameters<typeof createWebRtcUpstreamAudioSink>[0]['createStreamingRecognitionSession']
          >
        >[1]
      | undefined
    const sink = createWebRtcUpstreamAudioSink({
      createStreamingRecognitionSession: async (_callId, options) => {
        capturedOptions = options
        return {
          close: () => {},
          flush: async () => {
            await options.onFinal('让关羽汇报进度')
          },
          pushFrame: () => {},
        }
      },
      createVoiceIntentSession,
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
      callId: 'call-shadow-on',
      track: { kind: 'audio' },
      workspaceId: 'workspace-1',
    })
    if (!session) throw new Error('audio session was not created')

    if (!capturedOptions?.onPartial) throw new Error('streaming partial callback was not captured')
    await capturedOptions.onPartial('让关羽')
    await session.close()

    expect(createVoiceIntentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: 'call-shadow-on',
        turnId: 'call-shadow-on',
      })
    )
    expect(evaluate).toHaveBeenCalledWith({
      context: '',
      isFinal: false,
      partialSeq: 1,
      transcript: '让关羽',
    })
    expect(evaluate).toHaveBeenCalledWith({
      context: '',
      isFinal: true,
      partialSeq: 2,
      transcript: '让关羽汇报进度',
    })
    expect(store.inputs).toHaveLength(1)
    expect(store.inputs[0]?.text).toBe('[来自手机 Mobile App]\n---\n让关羽汇报进度')
    expect(infoLogs).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'voiceIntent shadow verdict: call_id=call-shadow-on partial_seq=1 completeness=likely_complete action=handled confidence=0.61 would_handoff=false distilled_intent=查询关羽进度'
        ),
        expect.stringContaining(
          'voiceIntent shadow verdict: call_id=call-shadow-on partial_seq=2 completeness=complete action=escalate confidence=0.86 would_handoff=true distilled_intent=让关羽汇报进度'
        ),
        expect.stringContaining(
          'voiceIntent shadow endpoint_compare: call_id=call-shadow-on partial_seq=2 endpoint=final latest_completeness=complete latest_action=escalate latest_confidence=0.86'
        ),
      ])
    )
    expect(closeIntentSession).toHaveBeenCalledTimes(1)
  })

  test('swallows voice intent shadow failures and keeps the streaming final injection path working', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    const store = createStore()
    const warnings: unknown[] = []
    const createVoiceIntentSession = vi.fn(() => ({
      close: vi.fn(),
      evaluate: vi.fn().mockRejectedValue(new Error('shadow failed')),
    }))
    const sink = createWebRtcUpstreamAudioSink({
      createStreamingRecognitionSession: async (_callId, options) => ({
        close: () => {},
        flush: async () => {
          await options.onFinal('让关羽汇报进度')
        },
        pushFrame: () => {},
      }),
      createVoiceIntentSession,
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
    })

    const session = await sink.start({
      callId: 'call-shadow-fail',
      track: { kind: 'audio' },
      workspaceId: 'workspace-1',
    })
    if (!session) throw new Error('audio session was not created')

    await expect(session.close()).resolves.toBeUndefined()

    expect(store.inputs).toEqual([
      {
        options: undefined,
        text: '[来自手机 Mobile App]\n---\n让关羽汇报进度',
        workspaceId: 'workspace-1',
        workerId: 'workspace-1:orchestrator',
      },
    ])
    expect(warnings).toEqual(
      expect.arrayContaining([expect.arrayContaining(['voice intent shadow evaluation failed'])])
    )
  })

  test('closes the voice intent shadow session when audio sink stop rejects', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    const store = createStore()
    const warnings: unknown[] = []
    const closeIntentSession = vi.fn()
    class RejectingAudioSink extends FakeAudioSink {
      override stop() {
        this.stopped = true
        throw new Error('audio sink stop failed')
      }
    }
    const sink = createWebRtcUpstreamAudioSink({
      createStreamingRecognitionSession: async () => ({
        close: () => {},
        flush: async () => {},
        pushFrame: () => {},
      }),
      createVoiceIntentSession: vi.fn(() => ({
        close: closeIntentSession,
        evaluate: vi.fn(),
      })),
      loadAudioSink: async () => RejectingAudioSink,
      logger: {
        info: () => {},
        warn: (...args) => warnings.push(args),
      },
      store,
      tempRoot: tmpdir(),
    })

    const session = await sink.start({
      callId: 'call-shadow-stop-rejects',
      track: { kind: 'audio' },
      workspaceId: 'workspace-1',
    })
    if (!session) throw new Error('audio session was not created')

    await expect(session.close()).resolves.toBeUndefined()

    expect(closeIntentSession).toHaveBeenCalledTimes(1)
    expect(warnings).toEqual(
      expect.arrayContaining([expect.arrayContaining(['failed to process WebRTC upstream audio'])])
    )
  })

  test('closes the streaming STT session even when flush rejects', async () => {
    const store = createStore()
    let closedStreaming = false
    const warnings: unknown[] = []
    const sink = createWebRtcUpstreamAudioSink({
      createStreamingRecognitionSession: async () => ({
        close: () => {
          closedStreaming = true
        },
        flush: async () => {
          throw new Error('flush failed')
        },
        pushFrame: () => {},
      }),
      loadAudioSink: async () => FakeAudioSink,
      logger: {
        info: () => {},
        warn: (...args) => warnings.push(args),
      },
      store,
      tempRoot: tmpdir(),
    })

    const session = await sink.start({
      callId: 'call-flush-fails',
      track: { kind: 'audio' },
      workspaceId: 'workspace-1',
    })
    if (!session) throw new Error('audio session was not created')

    await session.close()

    expect(closedStreaming).toBe(true)
    expect(warnings).toHaveLength(1)
  })

  test('falls back to batch VAD when streaming pushFrame fails during a call', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    const store = createStore()
    const warnings: unknown[] = []
    const transcribedPaths: string[] = []
    const sink = createWebRtcUpstreamAudioSink({
      createSttProvider: () => ({
        detect: async () => ({ command: 'fake-stt', provider: 'paraformer' }),
        transcribeAudioFile: async (audioPath) => {
          transcribedPaths.push(audioPath)
          return { provider: 'paraformer', text: 'fallback transcript' }
        },
      }),
      createStreamingRecognitionSession: async () => ({
        close: () => {},
        flush: async () => {},
        pushFrame: () => {
          throw new Error('streaming native failure')
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
      callId: 'call-streaming-fallback',
      track: { kind: 'audio' },
      workspaceId: 'workspace-1',
    })
    if (!session) throw new Error('audio session was not created')
    const audioSink = FakeAudioSink.instances[0]

    expect(() => emitFrame(audioSink, 5000)).not.toThrow()
    for (let index = 0; index < 3; index += 1) emitFrame(audioSink, 5000)
    for (let index = 0; index < 4; index += 1) emitFrame(audioSink, 0)

    await vi.waitFor(() => expect(store.inputs).toHaveLength(1), { timeout: 1000 })
    await session.close()

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['streaming WebRTC STT failed; falling back to batch VAD']),
      ])
    )
    expect(transcribedPaths).toHaveLength(1)
    expect(store.inputs[0]?.text).toBe('[来自手机 Mobile App]\n---\nfallback transcript')
  })

  test('formats WebRTC voice prompts with rolling session context when provided', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    const store = createStore()

    await injectWebRtcVoiceTranscript({
      fastVoiceReplyProvider: {
        generate: async () => 'HIVE_GLM_GATEKEEPER: escalate\n收到，我让主管处理。',
      },
      sessionContext: ['第一句', '第二句'],
      store,
      text: '第三句',
      workspaceId: 'workspace-1',
    })

    expect(store.inputs).toEqual([
      {
        options: undefined,
        text: '[对话上下文（本次通话之前说的）]\n第一句\n第二句\n\n[来自手机 Mobile App]\n---\n第三句',
        workspaceId: 'workspace-1',
        workerId: 'workspace-1:orchestrator',
      },
    ])
    expect(store.chat).toContainEqual({
      contentJson: JSON.stringify({ source: 'webrtc_call', text: '第三句' }),
      direction: 'inbound',
      messageType: 'user_text',
      workspaceId: 'workspace-1',
    })
  })

  test('limits rolling session context to the latest ten segments', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    const store = createStore()

    await injectWebRtcVoiceTranscript({
      fastVoiceReplyProvider: {
        generate: async () => 'HIVE_GLM_GATEKEEPER: escalate\n收到，我让主管处理。',
      },
      sessionContext: Array.from({ length: 12 }, (_, index) => `第${index + 1}句`),
      store,
      text: '当前句',
      workspaceId: 'workspace-1',
    })

    expect(store.inputs[0]?.text).not.toContain('第1句')
    expect(store.inputs[0]?.text).not.toContain('第2句')
    expect(store.inputs[0]?.text).toContain('第3句')
    expect(store.inputs[0]?.text).toContain('第12句')
  })

  test('limits rolling session context to at most 2000 characters', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    const store = createStore()

    await injectWebRtcVoiceTranscript({
      fastVoiceReplyProvider: {
        generate: async () => 'HIVE_GLM_GATEKEEPER: escalate\n收到，我让主管处理。',
      },
      sessionContext: ['旧'.repeat(1500), '新'.repeat(1200)],
      store,
      text: '当前句',
      workspaceId: 'workspace-1',
    })

    const contextBlock =
      store.inputs[0]?.text
        .split('\n\n[来自手机 Mobile App]')[0]
        ?.replace('[对话上下文（本次通话之前说的）]\n', '') ?? ''
    expect(contextBlock.length).toBeLessThanOrEqual(2000)
    expect(contextBlock).toContain('新'.repeat(100))
  })
})
