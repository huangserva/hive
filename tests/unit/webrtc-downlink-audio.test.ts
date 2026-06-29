import { afterEach, describe, expect, test, vi } from 'vitest'

import type { MobileChatMessage } from '../../src/server/mobile-chat-store.js'
import { createWebRtcDownlinkAudio } from '../../src/server/webrtc-downlink-audio.js'
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
  getPlaybackState?: () => unknown
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
    resetWebRtcVoiceLatencyForTests()
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

  test('logs WebRTC voice latency breakdown on the first pushed downlink frame', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(1_000)
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const infoLogs: string[] = []
    const turn = startWebRtcVoiceLatencyTurn({
      callId: 'call-latency',
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
    const downlink = createWebRtcDownlinkAudio({
      createTtsProvider: () => ({
        detect: async () => ({ command: 'edge-tts', provider: 'edge-tts' }),
        synthesize: async () => {
          vi.setSystemTime(1_200)
          return {
            audio: Buffer.from('audio'),
            format: 'mp3',
            mime: 'audio/mpeg',
            provider: 'edge-tts',
          }
        },
      }),
      decodeAudioToPcmFrames: async () => {
        vi.setSystemTime(1_300)
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
          return () => {}
        },
      },
      trackFactory: async () => ({
        onData: () => {
          vi.setSystemTime(1_400)
        },
        track: {
          kind: 'audio',
        },
      }),
    })

    const session = await startTestCall(downlink, {
      callId: 'call-latency',
      workspaceId: 'workspace-1',
    })
    emitMessage(listener, 'workspace-1', createMessage('reply'))

    await session.flush()

    expect(infoLogs).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'voice latency breakdown: call_id=call-latency turn_id=call-latency-turn-1 segment=1'
        ),
        expect.stringContaining(
          'final_to_fast_reply_ms=50 glm_ms=30 escalated=true gatekeeper_ms=50'
        ),
        expect.stringContaining('tts_ms=200 tts_to_first_frame_ms=200 final_to_downlink_ms=400'),
      ])
    )
    expect(markWebRtcVoiceLatency(turn.turnId, { ttsStartAt: 2_000 })).toBeNull()
  })

  test('exposes playback state while track downlink is synthesizing and sending audio', async () => {
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    let resolveSynthesize:
      | ((result: {
          audio: Buffer
          format: 'mp3'
          mime: 'audio/mpeg'
          provider: 'edge-tts'
        }) => void)
      | null = null
    let resolvePush: (() => void) | null = null
    const downlink = createWebRtcDownlinkAudio({
      createTtsProvider: () => ({
        detect: async () => ({ command: 'edge-tts', provider: 'edge-tts' }),
        synthesize: () =>
          new Promise((resolve) => {
            resolveSynthesize = resolve
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
      env: {
        ...process.env,
        HIVE_WEBRTC_DOWNLINK_GAIN: '1',
      },
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {}
        },
      },
      trackFactory: async () => ({
        onData: () =>
          new Promise<void>((resolve) => {
            resolvePush = resolve
          }),
        track: {
          kind: 'audio',
        },
      }),
    })

    const session = await startTestCall(downlink, {
      callId: 'call-playback-state',
      workspaceId: 'workspace-1',
    })
    expect(session.getPlaybackState?.()).toEqual(
      expect.objectContaining({
        generation: 0,
        state: 'idle',
      })
    )

    emitMessage(listener, 'workspace-1', createMessage('reply for echo suppression'))
    const flush = session.flush()
    await flushMicrotasks()

    expect(session.getPlaybackState?.()).toEqual(
      expect.objectContaining({
        generation: 0,
        messageId: 'message-1',
        state: 'synthesizing',
        textPreview: 'reply for echo suppression',
      })
    )

    resolveSynthesize?.({
      audio: Buffer.from('audio'),
      format: 'mp3',
      mime: 'audio/mpeg',
      provider: 'edge-tts',
    })
    await flushMicrotasks()

    expect(session.getPlaybackState?.()).toEqual(
      expect.objectContaining({
        bytes: 5,
        frames: 1,
        generation: 0,
        messageId: 'message-1',
        state: 'sending',
      })
    )

    resolvePush?.()
    await flush

    expect(session.getPlaybackState?.()).toEqual(
      expect.objectContaining({
        frames: 1,
        generation: 0,
        messageId: 'message-1',
        state: 'sent',
      })
    )
  })

  test('discards claimed WebRTC voice latency turn when TTS does not produce audio', async () => {
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const turn = startWebRtcVoiceLatencyTurn({
      callId: 'call-tts-null',
      now: 1_000,
      segment: 1,
      workspaceId: 'workspace-1',
    })
    const downlink = createWebRtcDownlinkAudio({
      createTtsProvider: () => ({
        detect: async () => ({ command: 'edge-tts', provider: 'edge-tts' }),
        synthesize: async () => null,
      }),
      logger: {
        info: () => {},
        warn: () => {},
      },
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {}
        },
      },
      trackFactory: async () => ({
        onData: () => {
          throw new Error('should not push audio')
        },
        track: {
          kind: 'audio',
        },
      }),
    })

    const session = await startTestCall(downlink, {
      callId: 'call-tts-null',
      workspaceId: 'workspace-1',
    })
    emitMessage(listener, 'workspace-1', createMessage('reply'))

    await session.flush()

    expect(markWebRtcVoiceLatency(turn.turnId, { ttsStartAt: 2_000 })).toBeNull()
  })

  test('applies default soft-clipped gain to PCM samples before pushing downlink audio', async () => {
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const pushedSamples: Int16Array[] = []
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
          samples: new Int16Array([-12_000, -1_000, 0, 1_000, 12_000]),
        },
      ],
      env: {
        ...process.env,
        HIVE_WEBRTC_DOWNLINK_GAIN: undefined,
      },
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {}
        },
      },
      trackFactory: async () => ({
        onData: (frame) => {
          pushedSamples.push(frame.samples)
        },
        track: {
          kind: 'audio',
        },
      }),
    })

    const session = await startTestCall(downlink, {
      callId: 'call-gain',
      workspaceId: 'workspace-1',
    })
    emitMessage(listener, 'workspace-1', createMessage('hello'))

    await session.flush()

    expect(pushedSamples).toHaveLength(1)
    expect(Array.from(pushedSamples[0] ?? [])).toEqual([-32_767, -3_000, 0, 3_000, 32_767])
  })

  test('uses HIVE_WEBRTC_DOWNLINK_GAIN to tune downlink PCM gain without recompiling', async () => {
    let listener: ((workspaceId: string, message: MobileChatMessage) => void) | null = null
    const pushedSamples: Int16Array[] = []
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
          samples: new Int16Array([-20_000, 1_500, 20_000]),
        },
      ],
      env: {
        ...process.env,
        HIVE_WEBRTC_DOWNLINK_GAIN: '2',
      },
      store: {
        registerMobileChatListener(nextListener) {
          listener = nextListener
          return () => {}
        },
      },
      trackFactory: async () => ({
        onData: (frame) => {
          pushedSamples.push(frame.samples)
        },
        track: {
          kind: 'audio',
        },
      }),
    })

    const session = await startTestCall(downlink, {
      callId: 'call-env-gain',
      workspaceId: 'workspace-1',
    })
    emitMessage(listener, 'workspace-1', createMessage('hello'))

    await session.flush()

    expect(pushedSamples).toHaveLength(1)
    expect(Array.from(pushedSamples[0] ?? [])).toEqual([-32_767, 3_000, 32_767])
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
      env: {
        ...process.env,
        HIVE_WEBRTC_DOWNLINK_GAIN: '1',
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
      env: {
        ...process.env,
        HIVE_WEBRTC_DOWNLINK_GAIN: '1',
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
      env: {
        ...process.env,
        HIVE_WEBRTC_DOWNLINK_GAIN: '1',
      },
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
      env: {
        ...process.env,
        HIVE_WEBRTC_DOWNLINK_GAIN: '1',
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
