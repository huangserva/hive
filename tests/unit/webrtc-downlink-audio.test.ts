import { afterEach, describe, expect, test, vi } from 'vitest'

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

const flushMicrotasks = async () => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

const emitMessage = (
  listener: ((workspaceId: string, message: MobileChatMessage) => void) | null,
  workspaceId: string,
  message: MobileChatMessage
) => {
  if (!listener) throw new Error('mobile chat listener was not registered')
  listener(workspaceId, message)
}

type TestDownlink = ReturnType<typeof createWebRtcDownlinkAudio>
type TestDownlinkSession = NonNullable<Awaited<ReturnType<TestDownlink['startCall']>>> & {
  flush(): Promise<void>
  interrupt(): void
}

const startTestCall = async (
  downlink: TestDownlink,
  input: { callId: string; workspaceId: string }
) => {
  const session = await downlink.startCall(input)
  if (!session || !('flush' in session)) throw new Error('test downlink session was not created')
  return session as TestDownlinkSession
}

describe('WebRTC downlink audio', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

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
          synthesizeCalls.push(options?.voice ? { text, voice: options.voice } : { text })
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

    const session = await startTestCall(downlink, {
      callId: 'call-1',
      workspaceId: 'workspace-1',
    })
    emitMessage(
      listener,
      'workspace-1',
      createMessage('**正式回复** https://example.test/file.apk')
    )

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

    const session = await startTestCall(downlink, {
      callId: 'call-1',
      workspaceId: 'workspace-1',
    })
    emitMessage(listener, 'workspace-2', createMessage('wrong workspace'))
    emitMessage(listener, 'workspace-1', {
      ...createMessage('user'),
      direction: 'inbound',
      message_type: 'user_text',
    })

    await session.flush()

    expect(pushedFrames).toEqual([])
  })

  test('paces PCM frames at the WebRTC 10ms audio cadence instead of bursting them', async () => {
    vi.useFakeTimers()
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const pushedFrames: number[] = []
    const createFrame = (value: number) => ({
      bitsPerSample: 16,
      channelCount: 1,
      numberOfFrames: 480,
      sampleRate: 48_000,
      samples: new Int16Array([value]),
    })
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
      decodeAudioToPcmFrames: async () => [createFrame(1), createFrame(2), createFrame(3)],
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {}
        },
      },
      trackFactory: async () => ({
        onData: (frame) => {
          pushedFrames.push(frame.samples[0] ?? 0)
        },
        track: {
          kind: 'audio',
        },
      }),
    })

    const session = await startTestCall(downlink, {
      callId: 'call-paced',
      workspaceId: 'workspace-1',
    })
    emitMessage(listener, 'workspace-1', createMessage('hello'))
    const flush = session.flush()

    await flushMicrotasks()
    expect(pushedFrames).toEqual([1])
    await vi.advanceTimersByTimeAsync(9)
    expect(pushedFrames).toEqual([1])
    await vi.advanceTimersByTimeAsync(1)
    expect(pushedFrames).toEqual([1, 2])
    await vi.advanceTimersByTimeAsync(10)
    await flush
    expect(pushedFrames).toEqual([1, 2, 3])
  })

  test('stops the paced frame timer when the call closes', async () => {
    vi.useFakeTimers()
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const pushedFrames: number[] = []
    const stopped: string[] = []
    const createFrame = (value: number) => ({
      bitsPerSample: 16,
      channelCount: 1,
      numberOfFrames: 480,
      sampleRate: 48_000,
      samples: new Int16Array([value]),
    })
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
      decodeAudioToPcmFrames: async () => [createFrame(1), createFrame(2), createFrame(3)],
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
          pushedFrames.push(frame.samples[0] ?? 0)
        },
        track: {
          kind: 'audio',
          stop: () => {
            stopped.push('track')
          },
        },
      }),
    })

    const session = await startTestCall(downlink, {
      callId: 'call-close',
      workspaceId: 'workspace-1',
    })
    emitMessage(listener, 'workspace-1', createMessage('hello'))

    await flushMicrotasks()
    expect(pushedFrames).toEqual([1])
    await session.close()
    await vi.advanceTimersByTimeAsync(100)

    expect(pushedFrames).toEqual([1])
    expect(stopped).toEqual(['track'])
    expect(listener).toBeNull()
  })

  test('does not accumulate timer drift when pushing frames is slower than one frame interval', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const pushedAt: number[] = []
    const createFrame = (value: number) => ({
      bitsPerSample: 16,
      channelCount: 1,
      numberOfFrames: 480,
      sampleRate: 48_000,
      samples: new Int16Array([value]),
    })
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
      decodeAudioToPcmFrames: async () => [createFrame(1), createFrame(2), createFrame(3)],
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {}
        },
      },
      trackFactory: async () => ({
        onData: async (frame) => {
          pushedAt.push(Date.now())
          expect(frame.samples[0]).toBe(pushedAt.length)
          await new Promise<void>((resolve) => setTimeout(resolve, 15))
        },
        track: {
          kind: 'audio',
        },
      }),
    })

    const session = await startTestCall(downlink, {
      callId: 'call-drift',
      workspaceId: 'workspace-1',
    })
    emitMessage(listener, 'workspace-1', createMessage('hello'))
    const flush = session.flush()

    await vi.advanceTimersByTimeAsync(100)
    await flush

    expect(pushedAt).toEqual([0, 15, 30])
  })

  test('interrupts current playback, drops queued old replies, and allows later replies', async () => {
    vi.useFakeTimers()
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const pushedFrames: number[] = []
    const synthesizeCalls: string[] = []
    const infoLogs: string[] = []
    const createFrame = (value: number) => ({
      bitsPerSample: 16,
      channelCount: 1,
      numberOfFrames: 480,
      sampleRate: 48_000,
      samples: new Int16Array([value]),
    })
    const downlink = createWebRtcDownlinkAudio({
      createTtsProvider: () => ({
        detect: async () => ({ command: 'edge-tts', provider: 'edge-tts' }),
        synthesize: async (text) => {
          synthesizeCalls.push(text)
          return {
            audio: Buffer.from(`audio:${text}`),
            format: 'mp3',
            mime: 'audio/mpeg',
            provider: 'edge-tts',
          }
        },
      }),
      decodeAudioToPcmFrames: async (audio) => {
        const text = audio.toString('utf8')
        if (text.endsWith('first')) return [createFrame(1), createFrame(2), createFrame(3)]
        if (text.endsWith('queued-old')) return [createFrame(9)]
        return [createFrame(4), createFrame(5)]
      },
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
      trackFactory: async () => ({
        onData: (frame) => {
          pushedFrames.push(frame.samples[0] ?? 0)
        },
        track: {
          kind: 'audio',
        },
      }),
    })

    const session = await startTestCall(downlink, {
      callId: 'call-interrupt',
      workspaceId: 'workspace-1',
    })
    emitMessage(listener, 'workspace-1', createMessage('first'))
    const firstFlush = session.flush()

    await flushMicrotasks()
    expect(pushedFrames).toEqual([1])
    emitMessage(listener, 'workspace-1', { ...createMessage('queued-old'), id: 'message-2' })
    session.interrupt()
    await firstFlush
    await vi.advanceTimersByTimeAsync(100)
    expect(pushedFrames).toEqual([1])

    emitMessage(listener, 'workspace-1', { ...createMessage('after'), id: 'message-3' })
    const secondFlush = session.flush()
    await vi.advanceTimersByTimeAsync(20)
    await secondFlush

    expect(pushedFrames).toEqual([1, 4, 5])
    expect(synthesizeCalls).toEqual(['first', 'after'])
    expect(infoLogs).toEqual(
      expect.arrayContaining([
        expect.stringContaining('downlink interrupted: call_id=call-interrupt'),
      ])
    )
  })
})
