import { describe, expect, test } from 'vitest'

import type { MobileChatMessage } from '../../src/server/mobile-chat-store.js'
import { createWebRtcDownlinkAudio } from '../../src/server/webrtc-downlink-audio.js'

const createMessage = (text: string): MobileChatMessage => ({
  content_json: JSON.stringify({ text }),
  created_at: 1,
  direction: 'outbound',
  id: 'message-1',
  message_type: 'orch_reply',
  workspace_id: 'workspace-1',
})

describe('WebRTC downlink audio', () => {
  test('synthesizes outbound orchestrator replies and pushes 48khz pcm frames to RTCAudioSource', async () => {
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const stopped: string[] = []
    const infoLogs: string[] = []
    const pushedFrames: Array<{
      bitsPerSample: number
      channelCount: number
      numberOfFrames: number
      sampleRate: number
      samples: Int16Array
    }> = []
    const synthesizeCalls: Array<{ text: string; voice?: string }> = []
    const downlink = createWebRtcDownlinkAudio({
      createTtsProvider: () => ({
        detect: async () => ({ command: 'edge-tts', provider: 'edge-tts' }),
        synthesize: async (text, options) => {
          synthesizeCalls.push({ text, voice: options?.voice })
          return {
            audio: Buffer.from(`audio:${text}`),
            format: 'mp3',
            mime: 'audio/mpeg',
            provider: 'edge-tts',
          }
        },
      }),
      decodeAudioToPcmFrames: async (audio) => {
        expect(audio).toEqual(Buffer.from('audio:正式回复 链接'))
        return [
          {
            bitsPerSample: 16,
            channelCount: 1,
            numberOfFrames: 480,
            sampleRate: 48_000,
            samples: new Int16Array(480),
          },
        ]
      },
      logger: {
        info: (message) => infoLogs.push(message),
        warn: () => {},
      },
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {
            listener = null
          }
        },
      },
      trackFactory: async () => ({
        onData: (frame) => {
          pushedFrames.push(frame)
        },
        track: {
          kind: 'audio',
          stop: () => {
            stopped.push('track')
          },
        },
      }),
    })

    const session = await downlink.startCall({
      callId: 'call-1',
      workspaceId: 'workspace-1',
    })
    listener?.('workspace-1', createMessage('**正式回复** https://example.test/file.apk'))

    await session.flush()

    expect(pushedFrames).toHaveLength(1)
    expect(infoLogs).toEqual(
      expect.arrayContaining([
        expect.stringContaining('audioSource created: call_id=call-1'),
        expect.stringContaining(
          'downlink audio pushing frames: call_id=call-1 message_id=message-1 frames=1'
        ),
        expect.stringContaining(
          'downlink audio pushed frames: call_id=call-1 message_id=message-1 pushed=1'
        ),
      ])
    )
    expect(pushedFrames[0]).toEqual({
      bitsPerSample: 16,
      channelCount: 1,
      numberOfFrames: 480,
      sampleRate: 48_000,
      samples: new Int16Array(480),
    })
    expect(synthesizeCalls).toEqual([{ text: '正式回复 链接', voice: 'zh-CN-XiaoxiaoNeural' }])

    await session.close()
    expect(stopped).toEqual(['track'])
    expect(listener).toBeNull()
  })

  test('ignores non-orchestrator and other-workspace messages', async () => {
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const pushedFrames: Int16Array[] = []
    const downlink = createWebRtcDownlinkAudio({
      createTtsProvider: () => ({
        detect: async () => ({ command: 'edge-tts', provider: 'edge-tts' }),
        synthesize: async () => ({
          audio: Buffer.from('audio'),
          format: 'mp3',
          mime: 'audio/mpeg',
          provider: 'edge-tts',
        }),
      }),
      decodeAudioToPcmFrames: async () => [
        {
          bitsPerSample: 16,
          channelCount: 1,
          numberOfFrames: 480,
          sampleRate: 48_000,
          samples: new Int16Array([1]),
        },
      ],
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {}
        },
      },
      trackFactory: async () => ({
        onData: (frame) => {
          pushedFrames.push(frame.samples)
        },
        track: {
          kind: 'audio',
        },
      }),
    })

    const session = await downlink.startCall({
      callId: 'call-1',
      workspaceId: 'workspace-1',
    })
    listener?.('workspace-2', createMessage('wrong workspace'))
    listener?.('workspace-1', {
      ...createMessage('user'),
      direction: 'inbound',
      message_type: 'user_text',
    })

    await session.flush()

    expect(pushedFrames).toEqual([])
  })
})
