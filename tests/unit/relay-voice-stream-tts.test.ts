import { describe, expect, test } from 'vitest'

import { createVoiceStreamTtsHandler } from '../../src/server/relay-voice-stream-tts.js'

describe('relay voice stream TTS handler', () => {
  test('defers stream TTS to WebRTC downlink when the same device has an active call', async () => {
    let detectCount = 0
    let synthesizeCount = 0
    const sent: unknown[] = []
    const handler = createVoiceStreamTtsHandler({
      createTtsProvider: () => ({
        async detect() {
          detectCount += 1
          return { command: 'say', provider: 'say' }
        },
        async synthesize() {
          synthesizeCount += 1
          return {
            audio: Buffer.from('audio'),
            format: 'm4a',
            mime: 'audio/mp4',
            provider: 'say',
          }
        },
      }),
      hasActiveWebRtcCall: (deviceId) => deviceId === 'device-1',
    })

    const handled = await handler(
      { op: 'open', seq: 0, stream_id: 'voice-audio', text: '你好', type: 'voice_stream' },
      { capabilities: ['send_prompt'], deviceId: 'device-1', send: (frame) => sent.push(frame) }
    )

    expect(handled).toBe(false)
    expect(detectCount).toBe(0)
    expect(synthesizeCount).toBe(0)
    expect(sent).toEqual([])
  })

  test('keeps synthesizing stream TTS when the device has no active WebRTC call', async () => {
    const sent: unknown[] = []
    const handler = createVoiceStreamTtsHandler({
      chunkSize: 4,
      createTtsProvider: () => ({
        async detect() {
          return { command: 'say', provider: 'say' }
        },
        async synthesize() {
          return {
            audio: Buffer.from('audio'),
            format: 'm4a',
            mime: 'audio/mp4',
            provider: 'say',
          }
        },
      }),
      hasActiveWebRtcCall: () => false,
    })

    const handled = await handler(
      { op: 'open', seq: 0, stream_id: 'voice-audio', text: '你好', type: 'voice_stream' },
      { capabilities: ['send_prompt'], deviceId: 'device-1', send: (frame) => sent.push(frame) }
    )

    expect(handled).toBe(true)
    expect(sent).toContainEqual(expect.objectContaining({ op: 'chunk', stream_id: 'voice-audio' }))
  })

  test('synthesizes open text and sends ordered audio chunks with done on the final frame', async () => {
    const sent: unknown[] = []
    const handler = createVoiceStreamTtsHandler({
      chunkSize: 4,
      createTtsProvider: () => ({
        async detect() {
          return { command: 'say', provider: 'say' }
        },
        async synthesize() {
          return {
            audio: Buffer.from('abcdefghijkl'),
            format: 'm4a',
            mime: 'audio/mp4',
            provider: 'say',
          }
        },
      }),
    })

    const handled = await handler(
      { op: 'open', seq: 0, stream_id: 'voice-audio', text: '你好', type: 'voice_stream' },
      { capabilities: ['send_prompt'], deviceId: 'device-1', send: (frame) => sent.push(frame) }
    )

    expect(handled).toBe(true)
    expect(sent).toEqual([
      expect.objectContaining({ done: false, payload: 'YWJj', seq: 1 }),
      expect.objectContaining({ done: false, payload: 'ZGVm', seq: 2 }),
      expect.objectContaining({ done: false, payload: 'Z2hp', seq: 3 }),
      expect.objectContaining({ done: true, payload: 'amts', seq: 4 }),
    ])
  })

  test('chunks base64 audio without corrupting buffers whose byte length is not divisible by 3', async () => {
    const original = Buffer.alloc(9_001)
    for (let i = 0; i < original.length; i++) original[i] = i % 251
    const sent: Array<{ done?: boolean; payload?: string }> = []
    const handler = createVoiceStreamTtsHandler({
      chunkSize: 8_192,
      createTtsProvider: () => ({
        async detect() {
          return { command: 'say', provider: 'say' }
        },
        async synthesize() {
          return {
            audio: original,
            format: 'm4a',
            mime: 'audio/mp4',
            provider: 'say',
          }
        },
      }),
    })

    const handled = await handler(
      { op: 'open', seq: 0, stream_id: 'voice-audio', text: '你好', type: 'voice_stream' },
      { capabilities: ['send_prompt'], deviceId: 'device-1', send: (frame) => sent.push(frame) }
    )

    expect(handled).toBe(true)
    expect(sent.length).toBeGreaterThan(1)
    expect(sent.at(-1)).toMatchObject({ done: true })
    const decoded = Buffer.from(sent.map((frame) => frame.payload ?? '').join(''), 'base64')
    expect(decoded.equals(original)).toBe(true)
  })

  test('rejects read-only devices before detecting or synthesizing TTS', async () => {
    let detectCount = 0
    let synthesizeCount = 0
    const sent: unknown[] = []
    const handler = createVoiceStreamTtsHandler({
      createTtsProvider: () => ({
        async detect() {
          detectCount += 1
          return { command: 'say', provider: 'say' }
        },
        async synthesize() {
          synthesizeCount += 1
          return {
            audio: Buffer.from('audio'),
            format: 'm4a',
            mime: 'audio/mp4',
            provider: 'say',
          }
        },
      }),
    })

    const handled = await handler(
      { op: 'open', seq: 0, stream_id: 'voice-audio', text: '你好', type: 'voice_stream' },
      { capabilities: ['read_dashboard'], deviceId: 'device-1', send: (frame) => sent.push(frame) }
    )

    expect(handled).toBe(true)
    expect(detectCount).toBe(0)
    expect(synthesizeCount).toBe(0)
    expect(sent).toEqual([
      expect.objectContaining({
        error: 'missing_mobile_capability: send_prompt',
        op: 'error',
        stream_id: 'voice-audio',
      }),
    ])
  })

  test('passes the requested stream voice to the TTS provider', async () => {
    let requestedVoice: string | undefined
    const sent: unknown[] = []
    const handler = createVoiceStreamTtsHandler({
      createTtsProvider: () => ({
        async detect() {
          return { command: 'edge-tts', provider: 'edge-tts' }
        },
        async synthesize(_text, options) {
          requestedVoice = options?.voice
          return {
            audio: Buffer.from('audio'),
            format: 'mp3',
            mime: 'audio/mpeg',
            provider: 'edge-tts',
          }
        },
      }),
    })

    const handled = await handler(
      {
        op: 'open',
        seq: 0,
        stream_id: 'voice-audio',
        text: '你好',
        type: 'voice_stream',
        voice: 'zh-CN-YunxiNeural',
      },
      { capabilities: ['send_prompt'], deviceId: 'device-1', send: (frame) => sent.push(frame) }
    )

    expect(handled).toBe(true)
    expect(requestedVoice).toBe('zh-CN-YunxiNeural')
    expect(sent).toContainEqual(expect.objectContaining({ op: 'chunk', stream_id: 'voice-audio' }))
  })

  test('sanitizes stream text before TTS without mutating the frame', async () => {
    let synthesizedText = ''
    const sent: unknown[] = []
    const frame = {
      op: 'open' as const,
      seq: 0,
      stream_id: 'voice-audio',
      text: '🔴 **构建完成** https://example.com/app-release-2.7.4-a1b2c3d4.apk `5aea765`',
      type: 'voice_stream' as const,
    }
    const handler = createVoiceStreamTtsHandler({
      createTtsProvider: () => ({
        async detect() {
          return { command: 'edge-tts', provider: 'edge-tts' }
        },
        async synthesize(text) {
          synthesizedText = text
          return {
            audio: Buffer.from('audio'),
            format: 'mp3',
            mime: 'audio/mpeg',
            provider: 'edge-tts',
          }
        },
      }),
    })

    await expect(
      handler(frame, {
        capabilities: ['send_prompt'],
        deviceId: 'device-1',
        send: (sentFrame) => sent.push(sentFrame),
      })
    ).resolves.toBe(true)

    expect(synthesizedText).toBe('构建完成 链接 一个版本')
    expect(frame.text).toContain('https://example.com')
    expect(sent).toContainEqual(expect.objectContaining({ op: 'chunk', stream_id: 'voice-audio' }))
  })
})
