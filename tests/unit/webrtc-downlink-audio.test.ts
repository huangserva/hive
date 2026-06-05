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
  test('synthesizes outbound orchestrator replies and writes them to the active downlink track', async () => {
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const writes: Buffer[] = []
    const stopped: string[] = []
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
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {
            listener = null
          }
        },
      },
      trackFactory: async () => ({
        track: {
          stop: () => {
            stopped.push('track')
          },
          writeAudio: async (audio) => {
            writes.push(audio)
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

    expect(writes).toEqual([Buffer.from('audio:正式回复 链接')])
    expect(synthesizeCalls).toEqual([{ text: '正式回复 链接', voice: 'zh-CN-XiaoxiaoNeural' }])

    await session.close()
    expect(stopped).toEqual(['track'])
    expect(listener).toBeNull()
  })

  test('ignores non-orchestrator and other-workspace messages', async () => {
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const writes: Buffer[] = []
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
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {}
        },
      },
      trackFactory: async () => ({
        track: {
          writeAudio: async (audio) => {
            writes.push(audio)
          },
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

    expect(writes).toEqual([])
  })
})
