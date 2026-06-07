import { afterEach, describe, expect, test, vi } from 'vitest'

import type { MobileChatMessage } from '../../src/server/mobile-chat-store.js'
import type { VoiceCallStateFrame } from '../../src/server/voice-call-state-protocol.js'
import type { VoiceDownlinkSegmentFrame } from '../../src/server/voice-downlink-segment-protocol.js'
import { createWebRtcFileDownlinkAudio } from '../../src/server/webrtc-file-downlink-audio.js'
import {
  bindWebRtcVoiceLatencyTurnToMessage,
  claimWebRtcVoiceLatencyTurnForId,
  markWebRtcVoiceLatency,
  resetWebRtcVoiceLatencyForTests,
  startWebRtcVoiceLatencyTurn,
} from '../../src/server/webrtc-voice-latency.js'

type VoiceFileDownlinkFrame = VoiceCallStateFrame | VoiceDownlinkSegmentFrame

const createMessage = (text: string): MobileChatMessage => ({
  content_json: JSON.stringify({ text }),
  created_at: 1,
  direction: 'outbound',
  id: 'message-1',
  message_type: 'orch_reply',
  workspace_id: 'workspace-1',
})

const createVoiceIntentFrontMessage = (
  text: string,
  intentGeneration?: number
): MobileChatMessage => ({
  ...createMessage(text),
  content_json: JSON.stringify({
    ...(intentGeneration !== undefined ? { intent_generation: intentGeneration } : {}),
    source: 'voice_intent_front',
    text,
    voice_intent: true,
  }),
  id: 'front-message-1',
})

const createCorrelatedPmMessage = (
  text: string,
  voiceLatencyTurnId: string,
  id = 'pm-message-1'
): MobileChatMessage => ({
  ...createMessage(text),
  content_json: JSON.stringify({ text, voice_latency_turn_id: voiceLatencyTurnId }),
  id,
})

const emitMessage = (
  listener: ((workspaceId: string, message: MobileChatMessage) => void) | null,
  workspaceId: string,
  message: MobileChatMessage
) => {
  if (!listener) throw new Error('mobile chat listener was not registered')
  listener(workspaceId, message)
}

describe('WebRTC file downlink audio', () => {
  afterEach(() => {
    resetWebRtcVoiceLatencyForTests()
    vi.useRealTimers()
  })

  test('synthesizes outbound replies and sends a single final voice_downlink_segment', async () => {
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const sent: VoiceFileDownlinkFrame[] = []
    const synthesizeCalls: Array<{ text: string; voice?: string }> = []
    const downlink = createWebRtcFileDownlinkAudio({
      chunkSize: 4,
      createTtsProvider: () => ({
        detect: async () => ({ command: 'edge-tts', provider: 'edge-tts' }),
        synthesize: async (text, options) => {
          synthesizeCalls.push(options?.voice ? { text, voice: options.voice } : { text })
          return {
            audio: Buffer.from('abcdefghij'),
            format: 'mp3',
            mime: 'audio/mpeg',
            provider: 'edge-tts',
          }
        },
      }),
      logger: { info: vi.fn(), warn: vi.fn() },
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {
            listener = null
          }
        },
      },
    })

    const session = await downlink.startCall({
      callId: 'call-1',
      send: (frame) => sent.push(frame),
      workspaceId: 'workspace-1',
    })
    emitMessage(listener, 'workspace-1', createMessage('**正式回复** https://example.test/app.apk'))
    await session.flush()

    expect(synthesizeCalls).toEqual([{ text: '正式回复 链接', voice: 'zh-CN-XiaoxiaoNeural' }])
    const segmentFrames = sent.filter(
      (frame): frame is VoiceDownlinkSegmentFrame => frame.type === 'voice_downlink_segment'
    )
    expect(segmentFrames.map((frame) => frame.op)).toEqual([
      'segment_open',
      'segment_chunk',
      'segment_chunk',
      'segment_chunk',
      'segment_chunk',
    ])
    expect(segmentFrames[0]).toMatchObject({
      call_id: 'call-1',
      generation: 0,
      is_final: true,
      segment_id: 1,
      text: '正式回复 链接',
      turn_id: 'message-1',
      type: 'voice_downlink_segment',
    })
    expect(segmentFrames.at(-1)).toMatchObject({ done: true, format: 'mp3', mime: 'audio/mpeg' })

    await session.close()
    expect(listener).toBeNull()
  })

  test('does not let an interrupted pending TTS block the next reply', async () => {
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const sent: VoiceFileDownlinkFrame[] = []
    let resolveFirst: (value: {
      audio: Buffer
      format: string
      mime: string
      provider: 'edge-tts'
    }) => void = () => {}
    const pendingFirst = new Promise<{
      audio: Buffer
      format: string
      mime: string
      provider: 'edge-tts'
    }>((resolve) => {
      resolveFirst = resolve
    })
    const synthesizeCalls: string[] = []
    const downlink = createWebRtcFileDownlinkAudio({
      chunkSize: 64,
      createTtsProvider: () => ({
        detect: async () => ({ command: 'edge-tts', provider: 'edge-tts' }),
        synthesize: async (text) => {
          synthesizeCalls.push(text)
          if (text === 'first') return pendingFirst
          return {
            audio: Buffer.from('second-audio'),
            format: 'mp3',
            mime: 'audio/mpeg',
            provider: 'edge-tts' as const,
          }
        },
      }),
      logger: { info: vi.fn(), warn: vi.fn() },
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {
            listener = null
          }
        },
      },
    })
    const session = await downlink.startCall({
      callId: 'call-1',
      send: (frame) => sent.push(frame),
      workspaceId: 'workspace-1',
    })

    emitMessage(listener, 'workspace-1', { ...createMessage('first'), id: 'message-first' })
    await Promise.resolve()
    expect(synthesizeCalls).toEqual(['first'])

    session.interrupt?.()
    emitMessage(listener, 'workspace-1', { ...createMessage('second'), id: 'message-second' })
    await session.flush()

    expect(synthesizeCalls).toEqual(['first', 'second'])
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ turn_id: 'message-second', type: 'voice_downlink_segment' }),
      ])
    )
    expect(sent).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ turn_id: 'message-first' })])
    )

    resolveFirst({
      audio: Buffer.from('first-audio'),
      format: 'mp3',
      mime: 'audio/mpeg',
      provider: 'edge-tts' as const,
    })
    await session.flush()
    expect(sent).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ turn_id: 'message-first' })])
    )
    await session.close()
  })

  test('serializes voice intent front and PM replies so they do not play at the same time', async () => {
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const sent: VoiceFileDownlinkFrame[] = []
    let resolveFront: (value: {
      audio: Buffer
      format: string
      mime: string
      provider: 'edge-tts'
    }) => void = () => {}
    const pendingFront = new Promise<{
      audio: Buffer
      format: string
      mime: string
      provider: 'edge-tts'
    }>((resolve) => {
      resolveFront = resolve
    })
    const synthesizeCalls: string[] = []
    const downlink = createWebRtcFileDownlinkAudio({
      chunkSize: 64,
      createTtsProvider: () => ({
        detect: async () => ({ command: 'edge-tts', provider: 'edge-tts' }),
        synthesize: async (text) => {
          synthesizeCalls.push(text)
          if (text === '我转给主管。') return pendingFront
          return {
            audio: Buffer.from('pm-audio'),
            format: 'mp3',
            mime: 'audio/mpeg',
            provider: 'edge-tts' as const,
          }
        },
      }),
      logger: { info: vi.fn(), warn: vi.fn() },
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {
            listener = null
          }
        },
      },
    })
    const session = await downlink.startCall({
      callId: 'call-1',
      send: (frame) => sent.push(frame),
      workspaceId: 'workspace-1',
    })

    emitMessage(listener, 'workspace-1', createVoiceIntentFrontMessage('我转给主管。'))
    emitMessage(listener, 'workspace-1', {
      ...createMessage('PM 回复'),
      id: 'pm-message-1',
    })
    await Promise.resolve()

    expect(synthesizeCalls).toEqual(['我转给主管。'])
    expect(sent.filter((frame) => frame.type === 'voice_downlink_segment')).toEqual([])

    resolveFront({
      audio: Buffer.from('front-audio'),
      format: 'mp3',
      mime: 'audio/mpeg',
      provider: 'edge-tts',
    })
    await session.flush()

    expect(synthesizeCalls).toEqual(['我转给主管。', 'PM 回复'])
    expect(
      sent
        .filter(
          (frame): frame is VoiceDownlinkSegmentFrame => frame.type === 'voice_downlink_segment'
        )
        .map((frame) => frame.turn_id)
    ).toEqual(expect.arrayContaining(['front-message-1', 'pm-message-1']))
    await session.close()
  })

  test('retracts an unsent speculative generation when a newer intent generation arrives', async () => {
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const sent: VoiceFileDownlinkFrame[] = []
    let resolveOld: (value: {
      audio: Buffer
      format: string
      mime: string
      provider: 'edge-tts'
    }) => void = () => {}
    const oldTts = new Promise<{
      audio: Buffer
      format: string
      mime: string
      provider: 'edge-tts'
    }>((resolve) => {
      resolveOld = resolve
    })
    const synthesizeCalls: string[] = []
    const downlink = createWebRtcFileDownlinkAudio({
      chunkSize: 64,
      createTtsProvider: () => ({
        detect: async () => ({ command: 'edge-tts', provider: 'edge-tts' }),
        synthesize: async (text) => {
          synthesizeCalls.push(text)
          if (text === '旧投机回复') return oldTts
          return {
            audio: Buffer.from('new-audio'),
            format: 'mp3',
            mime: 'audio/mpeg',
            provider: 'edge-tts' as const,
          }
        },
      }),
      logger: { info: vi.fn(), warn: vi.fn() },
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {
            listener = null
          }
        },
      },
    })
    const session = await downlink.startCall({
      callId: 'call-1',
      send: (frame) => sent.push(frame),
      workspaceId: 'workspace-1',
    })

    emitMessage(listener, 'workspace-1', {
      ...createVoiceIntentFrontMessage('旧投机回复', 1),
      id: 'front-old',
    })
    await Promise.resolve()
    emitMessage(listener, 'workspace-1', {
      ...createVoiceIntentFrontMessage('新投机回复', 2),
      id: 'front-new',
    })
    await session.flush()

    expect(synthesizeCalls).toEqual(['旧投机回复', '新投机回复'])
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          generation: 1,
          op: 'retract',
          retract_generation: 0,
          type: 'voice_downlink_segment',
        }),
        expect.objectContaining({
          generation: 1,
          op: 'segment_open',
          turn_id: 'front-new',
          type: 'voice_downlink_segment',
        }),
      ])
    )
    expect(sent).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ turn_id: 'front-old' })])
    )

    resolveOld({
      audio: Buffer.from('old-audio'),
      format: 'mp3',
      mime: 'audio/mpeg',
      provider: 'edge-tts',
    })
    await session.flush()
    expect(sent).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ turn_id: 'front-old' })])
    )
    await session.close()
  })

  test('does not retract a speculative generation after it has started playing', async () => {
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const sent: VoiceFileDownlinkFrame[] = []
    const downlink = createWebRtcFileDownlinkAudio({
      chunkSize: 64,
      createTtsProvider: () => ({
        detect: async () => ({ command: 'edge-tts', provider: 'edge-tts' }),
        synthesize: async (text) => ({
          audio: Buffer.from(`${text}-audio`),
          format: 'mp3',
          mime: 'audio/mpeg',
          provider: 'edge-tts' as const,
        }),
      }),
      logger: { info: vi.fn(), warn: vi.fn() },
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {
            listener = null
          }
        },
      },
    })
    const session = await downlink.startCall({
      callId: 'call-1',
      send: (frame) => sent.push(frame),
      workspaceId: 'workspace-1',
    })

    emitMessage(listener, 'workspace-1', {
      ...createVoiceIntentFrontMessage('已开播回复', 1),
      id: 'front-playing',
    })
    await session.flush()
    emitMessage(listener, 'workspace-1', {
      ...createVoiceIntentFrontMessage('后续回复', 2),
      id: 'front-next',
    })
    await session.flush()

    expect(sent).not.toEqual(expect.arrayContaining([expect.objectContaining({ op: 'retract' })]))
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ turn_id: 'front-playing', type: 'voice_downlink_segment' }),
        expect.objectContaining({ turn_id: 'front-next', type: 'voice_downlink_segment' }),
      ])
    )
    await session.close()
  })

  test('sends a file downlink interrupt frame so the mobile player can stop current playback', async () => {
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const sent: VoiceFileDownlinkFrame[] = []
    const downlink = createWebRtcFileDownlinkAudio({
      createTtsProvider: () => ({
        detect: async () => ({ command: 'edge-tts', provider: 'edge-tts' }),
        synthesize: async () => ({
          audio: Buffer.from('reply-audio'),
          format: 'mp3',
          mime: 'audio/mpeg',
          provider: 'edge-tts',
        }),
      }),
      logger: { info: vi.fn(), warn: vi.fn() },
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {
            listener = null
          }
        },
      },
    })
    const session = await downlink.startCall({
      callId: 'call-1',
      send: (frame) => sent.push(frame),
      workspaceId: 'workspace-1',
    })

    session.interrupt?.()

    expect(sent.filter((frame) => frame.type === 'voice_downlink_segment')).toEqual([
      expect.objectContaining({
        call_id: 'call-1',
        generation: 1,
        op: 'interrupt',
        segment_id: 0,
        seq: 0,
        type: 'voice_downlink_segment',
      }),
    ])

    emitMessage(listener, 'workspace-1', {
      ...createMessage('after interrupt'),
      id: 'message-after',
    })
    await session.flush()

    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          generation: 1,
          op: 'segment_open',
          turn_id: 'message-after',
        }),
      ])
    )
    await session.close()
  })

  test('logs WebRTC voice latency breakdown when the first file segment frame is sent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(1_000)
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const infoLogs: string[] = []
    const sent: VoiceFileDownlinkFrame[] = []
    const turn = startWebRtcVoiceLatencyTurn({
      callId: 'call-file-latency',
      now: 1_000,
      segment: 1,
      workspaceId: 'workspace-1',
    })
    markWebRtcVoiceLatency(turn.turnId, {
      escalated: true,
      fastReplyEnterAt: 1_050,
      gatekeeperAt: 1_100,
      glmRequestAt: 1_060,
      glmResponseAt: 1_090,
    })
    const downlink = createWebRtcFileDownlinkAudio({
      chunkSize: 4,
      createTtsProvider: () => ({
        detect: async () => ({ command: 'edge-tts', provider: 'edge-tts' }),
        synthesize: async () => {
          vi.setSystemTime(1_200)
          return {
            audio: Buffer.from('abcdefgh'),
            format: 'mp3',
            mime: 'audio/mpeg',
            provider: 'edge-tts',
          }
        },
      }),
      logger: {
        info: (message) => infoLogs.push(message),
        warn: () => {},
      },
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {}
        },
      },
    })

    const session = await downlink.startCall({
      callId: 'call-file-latency',
      send: (frame) => {
        sent.push(frame)
        vi.setSystemTime(1_300)
      },
      workspaceId: 'workspace-1',
    })
    emitMessage(listener, 'workspace-1', createMessage('reply'))

    await session.flush()

    expect(sent.length).toBeGreaterThan(0)
    expect(infoLogs).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'voice latency breakdown: call_id=call-file-latency turn_id=call-file-latency-turn-1 segment=1'
        ),
        expect.stringContaining(
          'final_to_fast_reply_ms=50 glm_ms=30 escalated=true gatekeeper_ms=50'
        ),
        expect.stringContaining('tts_ms=200 final_to_segment_ms=300 total_ms=300'),
      ])
    )
    expect(markWebRtcVoiceLatency(turn.turnId, { ttsStartAt: 2_000 })).toBeNull()
  })

  test('sends responding and listening call state around file segment playback', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(1_000)
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const sent: VoiceFileDownlinkFrame[] = []
    const turn = startWebRtcVoiceLatencyTurn({
      callId: 'call-state-downlink',
      now: 1_000,
      segment: 1,
      speechStartAt: 800,
      workspaceId: 'workspace-1',
    })
    markWebRtcVoiceLatency(turn.turnId, {
      branch: 'handled',
      decisionAt: 1_200,
      forwardPm: false,
      intentVerdictAt: 1_150,
      textLen: 4,
    })
    bindWebRtcVoiceLatencyTurnToMessage(turn.turnId, 'message-state')
    const infoLogs: string[] = []
    const downlink = createWebRtcFileDownlinkAudio({
      chunkSize: 4,
      createTtsProvider: () => ({
        detect: async () => ({ command: 'edge-tts', provider: 'edge-tts' }),
        synthesize: async () => ({
          audio: Buffer.from('abcdefghij'),
          format: 'mp3',
          mime: 'audio/mpeg',
          provider: 'edge-tts',
        }),
      }),
      logger: { info: (message) => infoLogs.push(message), warn: vi.fn() },
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {}
        },
      },
    })

    const session = await downlink.startCall({
      callId: 'call-state-downlink',
      send: (frame) => sent.push(frame),
      workspaceId: 'workspace-1',
    })
    emitMessage(listener, 'workspace-1', { ...createMessage('回复'), id: 'message-state' })

    await session.flush()

    const stateFrames = sent.filter(
      (frame): frame is VoiceCallStateFrame => frame.type === 'voice_call_state'
    )
    expect(stateFrames.map((frame) => frame.phase)).toEqual(['responding', 'listening'])
    expect(stateFrames).toEqual([
      expect.objectContaining({
        call_id: 'call-state-downlink',
        phase: 'responding',
        turn_id: turn.turnId,
        type: 'voice_call_state',
      }),
      expect.objectContaining({
        call_id: 'call-state-downlink',
        phase: 'listening',
        turn_id: turn.turnId,
        type: 'voice_call_state',
      }),
    ])
    expect(sent.filter((frame) => frame.type === 'voice_downlink_segment')).toHaveLength(5)
    expect(infoLogs).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          `voice call state sent: call_id=call-state-downlink turn_id=${turn.turnId} phase=responding`
        ),
        expect.stringContaining(
          `voice call state sent: call_id=call-state-downlink turn_id=${turn.turnId} phase=listening`
        ),
      ])
    )
  })

  test('returns to listening when file TTS produces no audio or throws before first segment', async () => {
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const sent: VoiceFileDownlinkFrame[] = []
    const nullTurn = startWebRtcVoiceLatencyTurn({
      callId: 'call-file-no-audio',
      segment: 1,
      workspaceId: 'workspace-1',
    })
    bindWebRtcVoiceLatencyTurnToMessage(nullTurn.turnId, 'message-null')
    const throwTurn = startWebRtcVoiceLatencyTurn({
      callId: 'call-file-no-audio',
      segment: 2,
      workspaceId: 'workspace-1',
    })
    bindWebRtcVoiceLatencyTurnToMessage(throwTurn.turnId, 'message-throw')
    const downlink = createWebRtcFileDownlinkAudio({
      createTtsProvider: () => ({
        detect: async () => ({ command: 'edge-tts', provider: 'edge-tts' }),
        synthesize: async (text) => {
          if (text === 'throw') throw new Error('tts failed')
          return null
        },
      }),
      logger: { info: vi.fn(), warn: vi.fn() },
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {}
        },
      },
    })

    const session = await downlink.startCall({
      callId: 'call-file-no-audio',
      send: (frame) => sent.push(frame),
      workspaceId: 'workspace-1',
    })
    emitMessage(listener, 'workspace-1', { ...createMessage('null'), id: 'message-null' })
    emitMessage(listener, 'workspace-1', { ...createMessage('throw'), id: 'message-throw' })

    await session.flush()

    const stateFrames = sent.filter(
      (frame): frame is VoiceCallStateFrame => frame.type === 'voice_call_state'
    )
    expect(stateFrames.map((frame) => [frame.phase, frame.turn_id])).toEqual([
      ['listening', nullTurn.turnId],
      ['listening', throwTurn.turnId],
    ])
    expect(sent.filter((frame) => frame.type === 'voice_downlink_segment')).toEqual([])
  })

  test('returns to listening when sanitized file downlink text is empty', async () => {
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const sent: VoiceFileDownlinkFrame[] = []
    const turn = startWebRtcVoiceLatencyTurn({
      callId: 'call-file-empty',
      segment: 1,
      workspaceId: 'workspace-1',
    })
    bindWebRtcVoiceLatencyTurnToMessage(turn.turnId, 'message-empty')
    const downlink = createWebRtcFileDownlinkAudio({
      createTtsProvider: () => ({
        detect: async () => ({ command: 'edge-tts', provider: 'edge-tts' }),
        synthesize: async () => {
          throw new Error('should not synthesize empty speech')
        },
      }),
      logger: { info: vi.fn(), warn: vi.fn() },
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {}
        },
      },
    })

    const session = await downlink.startCall({
      callId: 'call-file-empty',
      send: (frame) => sent.push(frame),
      workspaceId: 'workspace-1',
    })
    emitMessage(listener, 'workspace-1', { ...createMessage('❌'), id: 'message-empty' })

    await session.flush()

    expect(sent).toEqual([
      expect.objectContaining({
        phase: 'listening',
        turn_id: turn.turnId,
        type: 'voice_call_state',
      }),
    ])
  })

  test('does not let an unbound voice intent front acknowledgement consume the PM latency turn', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(1_000)
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const infoLogs: string[] = []
    const sent: VoiceFileDownlinkFrame[] = []
    const turn = startWebRtcVoiceLatencyTurn({
      callId: 'call-file-timeline',
      now: 1_000,
      segment: 1,
      speechStartAt: 500,
      workspaceId: 'workspace-1',
    })
    markWebRtcVoiceLatency(turn.turnId, {
      branch: 'escalate',
      decisionAt: 1_250,
      forwardPm: true,
      intentVerdictAt: 1_200,
      textLen: 7,
    })
    bindWebRtcVoiceLatencyTurnToMessage(turn.turnId, 'pm-message-1')
    const downlink = createWebRtcFileDownlinkAudio({
      chunkSize: 4,
      createTtsProvider: () => ({
        detect: async () => ({ command: 'edge-tts', provider: 'edge-tts' }),
        synthesize: async (text) => {
          vi.setSystemTime(text.includes('主管') ? 3_000 : 1_400)
          return {
            audio: Buffer.from(text.includes('主管') ? 'pm-audio' : 'front-audio'),
            format: 'mp3',
            mime: 'audio/mpeg',
            provider: 'edge-tts',
          }
        },
      }),
      logger: {
        info: (message) => infoLogs.push(message),
        warn: () => {},
      },
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {}
        },
      },
    })

    const session = await downlink.startCall({
      callId: 'call-file-timeline',
      send: (frame) => {
        sent.push(frame)
        if (frame.turn_id === 'pm-message-1') vi.setSystemTime(3_100)
      },
      workspaceId: 'workspace-1',
    })
    emitMessage(listener, 'workspace-1', createVoiceIntentFrontMessage('这个我转给主管。'))
    await session.flush()
    expect(infoLogs).not.toEqual([expect.stringContaining('voice turn timeline:')])

    emitMessage(listener, 'workspace-1', {
      ...createMessage('主管回复'),
      id: 'pm-message-1',
    })
    await session.flush()

    expect(infoLogs).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'voice turn timeline: call_id=call-file-timeline turn=call-file-timeline-turn-1 branch=escalate forward_pm=true text_len=7 speech_to_final_ms=500 final_to_verdict_ms=200 verdict_to_dispatch_ms=50 dispatch_to_downlink_ms=1850 total_speech_to_audio_ms=2600'
        ),
      ])
    )
    expect(sent).toEqual(
      expect.arrayContaining([expect.objectContaining({ turn_id: 'pm-message-1' })])
    )
  })

  test('discards claimed WebRTC voice latency turn when file TTS does not produce audio', async () => {
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const turn = startWebRtcVoiceLatencyTurn({
      callId: 'call-file-tts-null',
      now: 1_000,
      segment: 1,
      workspaceId: 'workspace-1',
    })
    const downlink = createWebRtcFileDownlinkAudio({
      createTtsProvider: () => ({
        detect: async () => ({ command: 'edge-tts', provider: 'edge-tts' }),
        synthesize: async () => null,
      }),
      logger: { info: vi.fn(), warn: vi.fn() },
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {}
        },
      },
    })

    const session = await downlink.startCall({
      callId: 'call-file-tts-null',
      send: (frame) => {
        if (frame.type === 'voice_downlink_segment') {
          throw new Error('should not send file segment')
        }
      },
      workspaceId: 'workspace-1',
    })
    emitMessage(listener, 'workspace-1', createMessage('reply'))

    await session.flush()

    expect(markWebRtcVoiceLatency(turn.turnId, { ttsStartAt: 2_000 })).toBeNull()
  })

  test('does not consume a voice latency turn for unrelated outbound replies without correlation', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(1_000)
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const infoLogs: string[] = []
    const turn = startWebRtcVoiceLatencyTurn({
      callId: 'call-no-fifo',
      now: 1_000,
      segment: 1,
      speechStartAt: 500,
      workspaceId: 'workspace-1',
    })
    markWebRtcVoiceLatency(turn.turnId, {
      branch: 'escalate',
      decisionAt: 1_250,
      forwardPm: true,
      intentVerdictAt: 1_200,
      textLen: 7,
    })
    const downlink = createWebRtcFileDownlinkAudio({
      chunkSize: 64,
      createTtsProvider: () => ({
        detect: async () => ({ command: 'edge-tts', provider: 'edge-tts' }),
        synthesize: async () => ({
          audio: Buffer.from('unrelated-audio'),
          format: 'mp3',
          mime: 'audio/mpeg',
          provider: 'edge-tts',
        }),
      }),
      logger: {
        info: (message) => infoLogs.push(message),
        warn: () => {},
      },
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {}
        },
      },
    })

    const session = await downlink.startCall({
      callId: 'call-no-fifo',
      send: () => {},
      workspaceId: 'workspace-1',
    })
    emitMessage(listener, 'workspace-1', {
      ...createMessage('桌面端无关回复'),
      id: 'unrelated-message',
    })
    await session.flush()

    expect(infoLogs).not.toEqual([expect.stringContaining('voice turn timeline:')])
    expect(
      claimWebRtcVoiceLatencyTurnForId(turn.turnId, {
        callId: 'call-no-fifo',
        workspaceId: 'workspace-1',
      })?.turnId
    ).toBe(turn.turnId)
  })

  test('claims the correlated PM reply instead of the oldest pending voice turn', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(1_000)
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const infoLogs: string[] = []
    const turn1 = startWebRtcVoiceLatencyTurn({
      callId: 'call-out-of-order',
      now: 1_000,
      segment: 1,
      speechStartAt: 500,
      workspaceId: 'workspace-1',
    })
    markWebRtcVoiceLatency(turn1.turnId, {
      branch: 'escalate',
      decisionAt: 1_200,
      forwardPm: true,
      intentVerdictAt: 1_150,
      textLen: 5,
    })
    const turn2 = startWebRtcVoiceLatencyTurn({
      callId: 'call-out-of-order',
      now: 2_000,
      segment: 2,
      speechStartAt: 1_500,
      workspaceId: 'workspace-1',
    })
    markWebRtcVoiceLatency(turn2.turnId, {
      branch: 'escalate',
      decisionAt: 2_250,
      forwardPm: true,
      intentVerdictAt: 2_200,
      textLen: 9,
    })
    const downlink = createWebRtcFileDownlinkAudio({
      chunkSize: 64,
      createTtsProvider: () => ({
        detect: async () => ({ command: 'edge-tts', provider: 'edge-tts' }),
        synthesize: async () => {
          vi.setSystemTime(3_000)
          return {
            audio: Buffer.from('pm-two-audio'),
            format: 'mp3',
            mime: 'audio/mpeg',
            provider: 'edge-tts',
          }
        },
      }),
      logger: {
        info: (message) => infoLogs.push(message),
        warn: () => {},
      },
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {}
        },
      },
    })

    const session = await downlink.startCall({
      callId: 'call-out-of-order',
      send: () => {
        vi.setSystemTime(3_100)
      },
      workspaceId: 'workspace-1',
    })
    emitMessage(listener, 'workspace-1', createCorrelatedPmMessage('第二个 PM 回复', turn2.turnId))
    await session.flush()

    expect(infoLogs).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'voice turn timeline: call_id=call-out-of-order turn=call-out-of-order-turn-2 branch=escalate forward_pm=true text_len=9'
        ),
      ])
    )
    expect(infoLogs).not.toEqual([
      expect.stringContaining('turn=call-out-of-order-turn-1 branch=escalate'),
    ])
    expect(
      claimWebRtcVoiceLatencyTurnForId(turn1.turnId, {
        callId: 'call-out-of-order',
        workspaceId: 'workspace-1',
      })?.turnId
    ).toBe(turn1.turnId)
  })
})
