import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, test, vi } from 'vitest'

import type { MobileChatMessageType } from '../../src/server/mobile-chat-store.js'
import {
  createVoiceCallStateSender,
  type VoiceCallStateFrame,
} from '../../src/server/voice-call-state-protocol.js'
import {
  createWebRtcUpstreamAudioSink,
  injectWebRtcVoiceTranscript,
} from '../../src/server/webrtc-upstream-audio.js'
import {
  buildVoiceTurnTimelineLog,
  claimWebRtcVoiceLatencyTurnForMessage,
  markWebRtcVoiceLatency,
  resetWebRtcVoiceLatencyForTests,
  startWebRtcVoiceLatencyTurn,
} from '../../src/server/webrtc-voice-latency.js'

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

const acceptedVoiceIntentUpdate = (overrides: {
  action?: 'clarify' | 'drop' | 'escalate' | 'handled'
  completeness?: 'complete' | 'incomplete' | 'likely_complete'
  confidence?: number
  distilledIntent?: string
  handoff?: boolean
  replyText?: string
}) => {
  const action = overrides.action ?? 'handled'
  const completeness = overrides.completeness ?? 'complete'
  const confidence = overrides.confidence ?? 0.9
  const distilledIntent = overrides.distilledIntent ?? ''
  const replyText = overrides.replyText ?? ''
  return {
    ...(overrides.handoff
      ? {
          handoff: {
            confidence,
            distilledIntent,
            intentGeneration: 1,
            transcript: 'raw transcript',
            turnId: 'call-1',
          },
        }
      : {}),
    status: 'accepted' as const,
    verdict: {
      action,
      completeness,
      confidence,
      distilled_intent: distilledIntent,
      intent_generation: 1,
      reason: 'test',
      reply_text: replyText,
      should_speculate_tts: false,
    },
  }
}

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
    resetWebRtcVoiceLatencyForTests()
    vi.useRealTimers()
    vi.unstubAllEnvs()
    FakeAudioSink.instances = []
  })

  test('captures remote PCM frames with RTCAudioSink, writes wav, and injects a voice prompt', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '0')
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

  test('voice intent complete escalate speaks the front reply and sends only distilled intent to orchestrator', async () => {
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    const store = createStore()

    await injectWebRtcVoiceTranscript({
      store,
      text: '关羽那个你帮我让他',
      voiceIntentUpdate: acceptedVoiceIntentUpdate({
        action: 'escalate',
        completeness: 'complete',
        confidence: 0.86,
        distilledIntent: '让关羽汇报 WebRTC 通话延迟进度',
        handoff: true,
        replyText: '懂了，这个我转给主管。',
      }),
      workspaceId: 'workspace-1',
    })

    expect(store.chat).toEqual([
      {
        contentJson: JSON.stringify({
          source: 'webrtc_call',
          text: '关羽那个你帮我让他',
        }),
        direction: 'inbound',
        messageType: 'user_text',
        workspaceId: 'workspace-1',
      },
      {
        contentJson: JSON.stringify({
          source: 'voice_intent_front',
          text: '懂了，这个我转给主管。',
          voice_intent: true,
        }),
        direction: 'outbound',
        messageType: 'orch_reply',
        workspaceId: 'workspace-1',
      },
    ])
    expect(store.inputs).toEqual([
      {
        options: undefined,
        text: '[来自手机 Mobile App]\n---\n让关羽汇报 WebRTC 通话延迟进度',
        workspaceId: 'workspace-1',
        workerId: 'workspace-1:orchestrator',
      },
    ])
    expect(store.inputs[0]?.text).not.toContain('关羽那个你帮我让他')
  })

  test('voice intent complete handled speaks directly without forwarding to orchestrator', async () => {
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    const store = createStore()
    const turn = startWebRtcVoiceLatencyTurn({
      callId: 'call-handled',
      now: 1_000,
      segment: 1,
      speechStartAt: 500,
      workspaceId: 'workspace-1',
    })
    markWebRtcVoiceLatency(turn.turnId, { intentVerdictAt: 1_200 })

    await injectWebRtcVoiceTranscript({
      latencyTurnId: turn.turnId,
      store,
      text: '现在谁在处理通话',
      voiceIntentUpdate: acceptedVoiceIntentUpdate({
        action: 'handled',
        completeness: 'complete',
        replyText: '关羽在处理通话延迟，赵云在看回声。',
      }),
      workspaceId: 'workspace-1',
    })

    expect(store.chat).toEqual([
      expect.objectContaining({
        direction: 'inbound',
        messageType: 'user_text',
      }),
      expect.objectContaining({
        contentJson: JSON.stringify({
          source: 'voice_intent_front',
          text: '关羽在处理通话延迟，赵云在看回声。',
          voice_intent: true,
        }),
        direction: 'outbound',
        messageType: 'orch_reply',
      }),
    ])
    expect(store.inputs).toEqual([
      {
        options: { forwardToOrchestrator: false },
        text: '[来自手机 Mobile App]\n---\n现在谁在处理通话',
        workspaceId: 'workspace-1',
        workerId: 'workspace-1:orchestrator',
      },
    ])
    const claimed = claimWebRtcVoiceLatencyTurnForMessage('message-2')
    expect(claimed?.turnId).toBe(turn.turnId)
  })

  test('voice intent incomplete can speak a short reply but does not record a completed turn or forward to PM', async () => {
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    const store = createStore()

    await injectWebRtcVoiceTranscript({
      store,
      text: '让关羽',
      voiceIntentUpdate: acceptedVoiceIntentUpdate({
        action: 'clarify',
        completeness: 'incomplete',
        confidence: 0.7,
        replyText: '你继续说，我在听。',
      }),
      workspaceId: 'workspace-1',
    })

    expect(store.inputs).toEqual([])
    expect(store.chat).toEqual([
      {
        contentJson: JSON.stringify({
          source: 'voice_intent_front',
          text: '你继续说，我在听。',
          voice_intent: true,
        }),
        direction: 'outbound',
        messageType: 'orch_reply',
        workspaceId: 'workspace-1',
      },
    ])
  })

  test('voice intent likely complete reply binds the latency turn for downlink totals', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(1_200)
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    const store = createStore()
    const turn = startWebRtcVoiceLatencyTurn({
      callId: 'call-likely',
      now: 1_000,
      segment: 1,
      speechStartAt: 700,
      workspaceId: 'workspace-1',
    })
    markWebRtcVoiceLatency(turn.turnId, { intentVerdictAt: 1_100 })

    await injectWebRtcVoiceTranscript({
      latencyTurnId: turn.turnId,
      store,
      text: '现在这个通话',
      voiceIntentUpdate: acceptedVoiceIntentUpdate({
        action: 'handled',
        completeness: 'likely_complete',
        confidence: 0.82,
        replyText: '现在通话已经接上，我继续看。',
      }),
      workspaceId: 'workspace-1',
    })

    const claimed = claimWebRtcVoiceLatencyTurnForMessage('message-1')
    expect(claimed?.turnId).toBe(turn.turnId)
    expect(claimed?.branch).toBe('handled')
    vi.setSystemTime(1_900)
    const completed = markWebRtcVoiceLatency(claimed?.turnId, { firstDownlinkFrameAt: Date.now() })
    expect(completed && buildVoiceTurnTimelineLog(completed)).toContain(
      'dispatch_to_downlink_ms=700 total_speech_to_audio_ms=1200'
    )
  })

  test('voice intent likely complete empty reply finishes without a downlink total', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(1_200)
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    const store = createStore()
    const infoLogs: string[] = []
    const turn = startWebRtcVoiceLatencyTurn({
      callId: 'call-likely-empty',
      now: 1_000,
      segment: 1,
      speechStartAt: 700,
      workspaceId: 'workspace-1',
    })
    markWebRtcVoiceLatency(turn.turnId, { intentVerdictAt: 1_100 })

    await injectWebRtcVoiceTranscript({
      latencyTurnId: turn.turnId,
      logger: { info: (message) => infoLogs.push(message), warn: () => {} },
      store,
      text: '现在这个通话',
      voiceIntentUpdate: acceptedVoiceIntentUpdate({
        action: 'handled',
        completeness: 'likely_complete',
        confidence: 0.82,
        replyText: '',
      }),
      workspaceId: 'workspace-1',
    })

    expect(claimWebRtcVoiceLatencyTurnForMessage('message-1')).toBeNull()
    expect(infoLogs).toEqual([
      expect.stringContaining(
        'voiceIntent driven decision: call_id=unknown completeness=likely_complete action=handled'
      ),
      expect.stringContaining(
        'branch=incomplete forward_pm=false text_len=6 speech_to_final_ms=300 final_to_verdict_ms=100 verdict_to_dispatch_ms=100 dispatch_to_downlink_ms=na total_speech_to_audio_ms=na'
      ),
    ])
  })

  test('voice intent drop stays silent and does not forward to PM', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(1_100)
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    const store = createStore()
    const infoLogs: string[] = []
    const turn = startWebRtcVoiceLatencyTurn({
      callId: 'call-drop',
      now: 1_000,
      segment: 1,
      speechStartAt: 700,
      workspaceId: 'workspace-1',
    })
    markWebRtcVoiceLatency(turn.turnId, { intentVerdictAt: 1_100 })

    await injectWebRtcVoiceTranscript({
      latencyTurnId: turn.turnId,
      logger: { info: (message) => infoLogs.push(message), warn: () => {} },
      store,
      text: '噪声',
      voiceIntentUpdate: acceptedVoiceIntentUpdate({
        action: 'drop',
        completeness: 'incomplete',
        confidence: 0.6,
      }),
      workspaceId: 'workspace-1',
    })

    expect(store.chat).toEqual([])
    expect(store.inputs).toEqual([])
    expect(infoLogs).toEqual([
      expect.stringContaining(
        'voiceIntent driven decision: call_id=unknown completeness=incomplete action=drop'
      ),
      'voice turn timeline: call_id=call-drop turn=call-drop-turn-1 branch=drop forward_pm=false text_len=2 speech_to_final_ms=300 final_to_verdict_ms=100 verdict_to_dispatch_ms=0 dispatch_to_downlink_ms=na total_speech_to_audio_ms=na',
    ])
    expect(markWebRtcVoiceLatency(turn.turnId, { decisionAt: 2_000 })).toBeNull()
  })

  test('voice intent front strips internal markers before speaking or forwarding', async () => {
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    const store = createStore()

    await injectWebRtcVoiceTranscript({
      store,
      text: '请处理',
      voiceIntentUpdate: acceptedVoiceIntentUpdate({
        action: 'escalate',
        completeness: 'complete',
        confidence: 0.9,
        distilledIntent: 'HIVE_GLM_GATEKEEPER: escalate\n让关羽修复通话延迟',
        handoff: true,
        replyText: 'HIVE_GLM_GATEKEEPER: handled\n这个我转给主管。 escalate',
      }),
      workspaceId: 'workspace-1',
    })

    expect(store.chat.at(1)?.contentJson).toBe(
      JSON.stringify({
        source: 'voice_intent_front',
        text: '这个我转给主管。',
        voice_intent: true,
      })
    )
    expect(store.inputs[0]?.text).toBe('[来自手机 Mobile App]\n---\n让关羽修复通话延迟')
  })

  test('voice intent true handoff keeps a handoff acknowledgement and sends distilled intent', async () => {
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    const store = createStore()
    const turn = startWebRtcVoiceLatencyTurn({
      callId: 'call-handoff',
      now: 1_000,
      segment: 1,
      workspaceId: 'workspace-1',
    })

    await injectWebRtcVoiceTranscript({
      latencyTurnId: turn.turnId,
      store,
      text: '让团队处理',
      voiceIntentUpdate: acceptedVoiceIntentUpdate({
        action: 'escalate',
        completeness: 'complete',
        confidence: 0.9,
        distilledIntent: '让团队处理 WebRTC 通话延迟',
        handoff: true,
        replyText: '这个我让团队上，马上',
      }),
      workspaceId: 'workspace-1',
    })

    expect(store.inputs).toEqual([
      {
        options: undefined,
        text: expect.stringContaining('[来自手机 Mobile App]\n---\n让团队处理 WebRTC 通话延迟'),
        workspaceId: 'workspace-1',
        workerId: 'workspace-1:orchestrator',
      },
    ])
    expect(store.inputs[0]?.text).not.toContain('voice_latency_turn_id')
    expect(store.inputs[0]?.text).not.toContain('内部语音延迟追踪')
    expect(store.chat.at(1)?.contentJson).toBe(
      JSON.stringify({
        source: 'voice_intent_front',
        text: '这个我让团队上，马上',
        voice_intent: true,
      })
    )
  })

  test('voice intent handoff acknowledgement is stripped when no PM handoff happens', async () => {
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    const store = createStore()

    await injectWebRtcVoiceTranscript({
      store,
      text: '现在进度',
      voiceIntentUpdate: acceptedVoiceIntentUpdate({
        action: 'handled',
        completeness: 'complete',
        replyText: '这个我让团队上，马上',
      }),
      workspaceId: 'workspace-1',
    })

    expect(store.chat).toEqual([
      expect.objectContaining({
        direction: 'inbound',
        messageType: 'user_text',
      }),
    ])
    expect(store.inputs[0]?.options).toEqual({ forwardToOrchestrator: false })
  })

  test('voice intent result claims are stripped even when a real handoff happens', async () => {
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    const store = createStore()

    await injectWebRtcVoiceTranscript({
      store,
      text: '部署一下',
      voiceIntentUpdate: acceptedVoiceIntentUpdate({
        action: 'escalate',
        completeness: 'complete',
        confidence: 0.9,
        distilledIntent: '让主管处理部署请求',
        handoff: true,
        replyText: '已部署完成',
      }),
      workspaceId: 'workspace-1',
    })

    expect(store.inputs).toHaveLength(1)
    expect(store.chat).toEqual([
      expect.objectContaining({
        direction: 'inbound',
        messageType: 'user_text',
      }),
    ])
  })

  test('voice intent sanitizer keeps ordinary handled and escalate words in body text', async () => {
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    const store = createStore()

    await injectWebRtcVoiceTranscript({
      store,
      text: '解释一下英文',
      voiceIntentUpdate: acceptedVoiceIntentUpdate({
        action: 'handled',
        completeness: 'complete',
        replyText: '这里的 handled 和 escalate 是英文状态词。',
      }),
      workspaceId: 'workspace-1',
    })

    expect(store.chat.at(1)?.contentJson).toBe(
      JSON.stringify({
        source: 'voice_intent_front',
        text: '这里的 handled 和 escalate 是英文状态词。',
        voice_intent: true,
      })
    )
  })

  test('voice intent safe zero-confidence drop falls back to the legacy gatekeeper path', async () => {
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    const store = createStore()
    const provider = {
      generate: vi.fn().mockResolvedValue('HIVE_GLM_GATEKEEPER: escalate\n收到，我转主管。'),
    }

    await injectWebRtcVoiceTranscript({
      fastVoiceReplyProvider: provider,
      store,
      text: '让关羽汇报进度',
      voiceIntentUpdate: acceptedVoiceIntentUpdate({
        action: 'drop',
        completeness: 'incomplete',
        confidence: 0,
      }),
      workspaceId: 'workspace-1',
    })

    expect(provider.generate).toHaveBeenCalled()
    expect(store.inputs).toHaveLength(1)
    expect(store.inputs[0]?.text).toContain('让关羽汇报进度')
  })

  test('intent front final without a verdict uses the safe reply instead of the legacy gatekeeper', async () => {
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    const store = createStore()
    const provider = {
      generate: vi.fn().mockResolvedValue('HIVE_GLM_GATEKEEPER: escalate\n收到，我转主管。'),
    }
    const turn = startWebRtcVoiceLatencyTurn({
      callId: 'call-1',
      segment: 1,
      workspaceId: 'workspace-1',
    })

    await injectWebRtcVoiceTranscript({
      fastVoiceReplyProvider: provider,
      latencyTurnId: turn.turnId,
      store,
      text: '继续查这个问题',
      workspaceId: 'workspace-1',
    })

    expect(provider.generate).not.toHaveBeenCalled()
    expect(store.inputs).toEqual([
      expect.objectContaining({
        options: expect.objectContaining({ forwardToOrchestrator: false }),
        text: expect.stringContaining('继续查这个问题'),
      }),
    ])
    expect(store.chat).toEqual([
      expect.objectContaining({
        direction: 'outbound',
        messageType: 'orch_reply',
      }),
    ])
    expect(JSON.parse(store.chat[0]?.contentJson ?? '{}')).toEqual({
      source: 'voice_intent_front',
      text: '我听到了，先继续说。',
      voice_intent: true,
    })
    expect(claimWebRtcVoiceLatencyTurnForMessage('message-1')?.turnId).toBe('call-1-turn-1')
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
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '0')
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

  test('keeps barge-in onset detection alive while streaming STT handles transcription', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '0')
    const store = createStore()
    const onSpeechStart = vi.fn()
    let batchDetectCount = 0
    const pushedFrames: Array<{ bitsPerSample: number; pcmBuffer: Buffer; sampleRate: number }> = []
    const sink = createWebRtcUpstreamAudioSink({
      createSttProvider: () => ({
        detect: async () => {
          batchDetectCount += 1
          return { command: 'fake-stt', provider: 'paraformer' }
        },
        transcribeAudioFile: async () => ({ provider: 'paraformer', text: 'batch' }),
      }),
      createStreamingRecognitionSession: async (_callId, options) => ({
        close: () => {},
        flush: async () => {
          await options.onFinal('流式最终文本')
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
        speechStartConfirmationFrames: 3,
      },
    })

    const session = await sink.start({
      callId: 'call-streaming-barge-in',
      onSpeechStart,
      track: { kind: 'audio' },
      workspaceId: 'workspace-1',
    })
    if (!session) throw new Error('audio session was not created')
    const audioSink = FakeAudioSink.instances[0]
    for (let index = 0; index < 3; index += 1) emitFrame(audioSink, 5000)
    for (let index = 0; index < 2; index += 1) emitFrame(audioSink, 5000)
    await session.close()

    expect(onSpeechStart).toHaveBeenCalledTimes(1)
    expect(pushedFrames).toHaveLength(5)
    expect(batchDetectCount).toBe(0)
    expect(store.inputs).toEqual([
      {
        options: undefined,
        text: '[来自手机 Mobile App]\n---\n流式最终文本',
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

  test('sends call state frames for streaming heard, processing, and silent drop', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    const store = createStore()
    const sentStates: VoiceCallStateFrame[] = []
    const createVoiceIntentSession = vi.fn(() => ({
      close: vi.fn(),
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(
          acceptedVoiceIntentUpdate({
            action: 'handled',
            completeness: 'likely_complete',
            confidence: 0.6,
          })
        )
        .mockResolvedValueOnce(
          acceptedVoiceIntentUpdate({
            action: 'drop',
            completeness: 'incomplete',
            confidence: 0.6,
          })
        )
        .mockResolvedValueOnce(
          acceptedVoiceIntentUpdate({
            action: 'drop',
            completeness: 'incomplete',
            confidence: 0.6,
          })
        ),
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
            await options.onFinal('噪声')
          },
          pushFrame: () => {},
        }
      },
      createVoiceIntentSession,
      loadAudioSink: async () => FakeAudioSink,
      logger: {
        info: () => {},
        warn: () => {},
      },
      store,
      tempRoot: tmpdir(),
    })

    const session = await sink.start({
      callId: 'call-state',
      sendCallState: (frame) => sentStates.push(frame),
      track: { kind: 'audio' },
      workspaceId: 'workspace-1',
    })
    if (!session) throw new Error('audio session was not created')
    if (!capturedOptions?.onPartial) throw new Error('streaming partial callback was not captured')

    await capturedOptions.onPartial('噪')
    await capturedOptions.onPartial('噪声')
    await session.close()

    expect(sentStates.map((frame) => frame.phase)).toEqual(['heard', 'processing', 'listening'])
    expect(sentStates).toEqual([
      expect.objectContaining({
        call_id: 'call-state',
        phase: 'heard',
        turn_id: 'call-state-turn-1',
        type: 'voice_call_state',
      }),
      expect.objectContaining({
        call_id: 'call-state',
        phase: 'processing',
        turn_id: 'call-state-turn-1',
        type: 'voice_call_state',
      }),
      expect.objectContaining({
        call_id: 'call-state',
        phase: 'listening',
        turn_id: 'call-state-turn-1',
        type: 'voice_call_state',
      }),
    ])
    expect(store.chat).toEqual([])
    expect(store.inputs).toEqual([])
  })

  test('does not crash when call state sender is absent', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    const store = createStore()
    const sink = createWebRtcUpstreamAudioSink({
      createStreamingRecognitionSession: async (_callId, options) => ({
        close: () => {},
        flush: async () => {
          await options.onFinal('团队成员：关羽、马超、赵云、钟馗、吕布')
        },
        pushFrame: () => {},
      }),
      createVoiceIntentSession: () => ({
        close: vi.fn(),
        evaluate: vi.fn().mockResolvedValue(
          acceptedVoiceIntentUpdate({
            action: 'drop',
            completeness: 'incomplete',
            confidence: 0.6,
          })
        ),
      }),
      loadAudioSink: async () => FakeAudioSink,
      logger: {
        info: () => {},
        warn: () => {},
      },
      store,
      tempRoot: tmpdir(),
    })

    const session = await sink.start({
      callId: 'call-state-no-sender',
      track: { kind: 'audio' },
      workspaceId: 'workspace-1',
    })
    if (!session) throw new Error('audio session was not created')
    await expect(session.close()).resolves.toBeUndefined()
  })

  test('watchdog returns an empty-handoff escalate turn to listening when PM does not reply', async () => {
    vi.useFakeTimers()
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    const store = createStore()
    const sentStates: VoiceCallStateFrame[] = []
    const stateSender = createVoiceCallStateSender<VoiceCallStateFrame>({
      callId: 'call-watchdog',
      send: (frame) => sentStates.push(frame),
      watchdogMs: 100,
    })
    const sink = createWebRtcUpstreamAudioSink({
      createStreamingRecognitionSession: async (_callId, options) => ({
        close: () => {},
        flush: async () => {
          await options.onFinal('让关羽处理')
        },
        pushFrame: () => {},
      }),
      createVoiceIntentSession: () => ({
        close: vi.fn(),
        evaluate: vi.fn().mockResolvedValue(
          acceptedVoiceIntentUpdate({
            action: 'escalate',
            completeness: 'complete',
            confidence: 0.9,
            distilledIntent: '让关羽处理通话问题',
            handoff: true,
            replyText: '已部署完成',
          })
        ),
      }),
      loadAudioSink: async () => FakeAudioSink,
      logger: {
        info: () => {},
        warn: () => {},
      },
      store,
      tempRoot: tmpdir(),
    })

    const session = await sink.start({
      callId: 'call-watchdog',
      sendCallState: stateSender.send,
      track: { kind: 'audio' },
      workspaceId: 'workspace-1',
    })
    if (!session) throw new Error('audio session was not created')

    await session.close()
    expect(sentStates.map((frame) => frame.phase)).toEqual(['processing'])
    vi.advanceTimersByTime(100)

    expect(sentStates.map((frame) => frame.phase)).toEqual(['processing', 'listening'])
    expect(sentStates.at(-1)).toMatchObject({
      call_id: 'call-watchdog',
      turn_id: 'call-watchdog-turn-1',
      type: 'voice_call_state',
    })
    expect(store.inputs).toEqual([
      expect.objectContaining({ text: '[来自手机 Mobile App]\n---\n让关羽处理通话问题' }),
    ])
  })

  test('safe fallback gatekeeper drop returns the turn to listening immediately', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '1')
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    const store = createStore()
    const sentStates: VoiceCallStateFrame[] = []
    const sink = createWebRtcUpstreamAudioSink({
      createStreamingRecognitionSession: async (_callId, options) => ({
        close: () => {},
        flush: async () => {
          await options.onFinal('团队成员：关羽、马超、赵云、钟馗、吕布')
        },
        pushFrame: () => {},
      }),
      createVoiceIntentSession: () => ({
        close: vi.fn(),
        evaluate: vi.fn().mockResolvedValue(
          acceptedVoiceIntentUpdate({
            action: 'drop',
            completeness: 'incomplete',
            confidence: 0,
          })
        ),
      }),
      fastVoiceReplyProvider: {
        generate: async () => {
          throw new Error('drop should happen before model generation')
        },
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
      callId: 'call-fallback-drop',
      sendCallState: (frame) => sentStates.push(frame),
      track: { kind: 'audio' },
      workspaceId: 'workspace-1',
    })
    if (!session) throw new Error('audio session was not created')

    await session.close()

    expect(sentStates.map((frame) => frame.phase)).toEqual(['processing', 'listening'])
    expect(store.chat).toEqual([])
    expect(store.inputs).toEqual([])
  })

  test('intent front final without a verdict does not fall back to slow gatekeeper escalation', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '1')
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    const store = createStore()
    const sentStates: VoiceCallStateFrame[] = []
    const provider = {
      generate: vi.fn(async () => 'HIVE_GLM_GATEKEEPER: escalate\n收到，我让主管处理。'),
    }
    const sink = createWebRtcUpstreamAudioSink({
      createStreamingRecognitionSession: async (_callId, options) => ({
        close: () => {},
        flush: async () => {
          await options.onFinal('让关羽帮我处理一下通话延迟')
        },
        pushFrame: () => {},
      }),
      createVoiceIntentSession: () => ({
        close: vi.fn(),
        evaluate: vi.fn().mockResolvedValue({ status: 'superseded' }),
      }),
      fastVoiceReplyProvider: provider,
      loadAudioSink: async () => FakeAudioSink,
      logger: {
        info: () => {},
        warn: () => {},
      },
      store,
      tempRoot: tmpdir(),
    })

    const session = await sink.start({
      callId: 'call-null-intent',
      sendCallState: (frame) => sentStates.push(frame),
      track: { kind: 'audio' },
      workspaceId: 'workspace-1',
    })
    if (!session) throw new Error('audio session was not created')

    await session.close()

    expect(provider.generate).not.toHaveBeenCalled()
    expect(store.inputs).toEqual([
      expect.objectContaining({
        options: { forwardToOrchestrator: false },
        text: '[来自手机 Mobile App]\n---\n让关羽帮我处理一下通话延迟',
      }),
    ])
    expect(store.chat).toEqual([
      expect.objectContaining({
        contentJson: JSON.stringify({
          source: 'voice_intent_front',
          text: '我听到了，先继续说。',
          voice_intent: true,
        }),
        direction: 'outbound',
        messageType: 'orch_reply',
      }),
    ])
    expect(sentStates.map((frame) => frame.phase)).toEqual(['processing'])
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
    expect(store.inputs[0]?.text).toContain('[来自手机 Mobile App]\n---\n让关羽汇报进度')
    expect(store.inputs[0]?.text).not.toContain('voice_latency_turn_id')
    expect(store.inputs[0]?.text).not.toContain('内部语音延迟追踪')
    expect(infoLogs).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'voiceIntent shadow verdict: call_id=call-shadow-on partial_seq=1 text="让关羽" completeness=likely_complete action=handled confidence=0.61 would_handoff=false distilled_intent=查询关羽进度'
        ),
        expect.stringContaining(
          'voiceIntent shadow verdict: call_id=call-shadow-on partial_seq=2 text="让关羽汇报进度" completeness=complete action=escalate confidence=0.86 would_handoff=true distilled_intent=让关羽汇报进度'
        ),
        expect.stringContaining(
          'voiceIntent shadow endpoint_compare: call_id=call-shadow-on partial_seq=2 endpoint=final final_text="让关羽汇报进度" latest_completeness=complete latest_action=escalate latest_confidence=0.86'
        ),
      ])
    )
    expect(closeIntentSession).toHaveBeenCalledTimes(1)
  })

  test('truncates voice intent shadow transcript text in logs', async () => {
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    const store = createStore()
    const infoLogs: string[] = []
    const evaluate = vi.fn().mockResolvedValue({
      candidate: {
        action: 'handled',
        completeness: 'incomplete',
        confidence: 0.4,
        distilledIntent: '',
        intentGeneration: 1,
        replyText: '',
        shouldSpeculateTts: false,
        transcript: '',
      },
      status: 'accepted',
      verdict: {
        action: 'handled',
        completeness: 'incomplete',
        confidence: 0.4,
        distilled_intent: '',
        intent_generation: 1,
        reason: 'glm_verdict',
        reply_text: '',
        should_speculate_tts: false,
      },
    })
    const createVoiceIntentSession = vi.fn(() => ({
      close: vi.fn(),
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
          flush: async () => {},
          pushFrame: () => {},
        }
      },
      createVoiceIntentSession,
      loadAudioSink: async () => FakeAudioSink,
      logger: {
        info: (message) => infoLogs.push(message),
        warn: () => {},
      },
      store,
      tempRoot: tmpdir(),
    })

    const session = await sink.start({
      callId: 'call-shadow-truncate',
      track: { kind: 'audio' },
      workspaceId: 'workspace-1',
    })
    if (!session) throw new Error('audio session was not created')
    if (!capturedOptions?.onPartial) throw new Error('streaming partial callback was not captured')

    const longText = '很'.repeat(130)
    await capturedOptions.onPartial(longText)
    await session.close()

    expect(infoLogs).toEqual(
      expect.arrayContaining([expect.stringContaining(`text="${'很'.repeat(120)}"`)])
    )
    expect(infoLogs.join('\n')).not.toContain(`text="${'很'.repeat(121)}`)
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
        options: { forwardToOrchestrator: false },
        text: '[来自手机 Mobile App]\n---\n让关羽汇报进度',
        workspaceId: 'workspace-1',
        workerId: 'workspace-1:orchestrator',
      },
    ])
    expect(store.chat).toEqual([
      expect.objectContaining({
        contentJson: JSON.stringify({
          source: 'voice_intent_front',
          text: '我听到了，先继续说。',
          voice_intent: true,
        }),
        direction: 'outbound',
        messageType: 'orch_reply',
      }),
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
