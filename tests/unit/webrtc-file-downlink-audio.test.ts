import { afterEach, describe, expect, test, vi } from 'vitest'

import type { MobileChatMessage } from '../../src/server/mobile-chat-store.js'
import type { VoiceDownlinkSegmentFrame } from '../../src/server/voice-downlink-segment-protocol.js'
import { createWebRtcFileDownlinkAudio } from '../../src/server/webrtc-file-downlink-audio.js'
import {
  markWebRtcVoiceLatency,
  resetWebRtcVoiceLatencyForTests,
  startWebRtcVoiceLatencyTurn,
} from '../../src/server/webrtc-voice-latency.js'

const createMessage = (text: string): MobileChatMessage => ({
  content_json: JSON.stringify({ text }),
  created_at: 1,
  direction: 'outbound',
  id: 'message-1',
  message_type: 'orch_reply',
  workspace_id: 'workspace-1',
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
    const sent: VoiceDownlinkSegmentFrame[] = []
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
    expect(sent.map((frame) => frame.op)).toEqual([
      'segment_open',
      'segment_chunk',
      'segment_chunk',
      'segment_chunk',
      'segment_chunk',
    ])
    expect(sent[0]).toMatchObject({
      call_id: 'call-1',
      generation: 0,
      is_final: true,
      segment_id: 1,
      text: '正式回复 链接',
      turn_id: 'message-1',
      type: 'voice_downlink_segment',
    })
    expect(sent.at(-1)).toMatchObject({ done: true, format: 'mp3', mime: 'audio/mpeg' })

    await session.close()
    expect(listener).toBeNull()
  })

  test('does not let an interrupted pending TTS block the next reply', async () => {
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const sent: VoiceDownlinkSegmentFrame[] = []
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

  test('sends a file downlink interrupt frame so the mobile player can stop current playback', async () => {
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const sent: VoiceDownlinkSegmentFrame[] = []
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

    expect(sent).toEqual([
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
    const sent: VoiceDownlinkSegmentFrame[] = []
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
      send: () => {
        throw new Error('should not send file segment')
      },
      workspaceId: 'workspace-1',
    })
    emitMessage(listener, 'workspace-1', createMessage('reply'))

    await session.flush()

    expect(markWebRtcVoiceLatency(turn.turnId, { ttsStartAt: 2_000 })).toBeNull()
  })
})
