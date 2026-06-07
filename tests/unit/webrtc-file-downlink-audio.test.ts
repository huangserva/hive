import { describe, expect, test, vi } from 'vitest'

import type { MobileChatMessage } from '../../src/server/mobile-chat-store.js'
import type { VoiceDownlinkSegmentFrame } from '../../src/server/voice-downlink-segment-protocol.js'
import { createWebRtcFileDownlinkAudio } from '../../src/server/webrtc-file-downlink-audio.js'

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
})
