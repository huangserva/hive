import { describe, expect, test } from 'vitest'

import { createWebRtcUtteranceVad } from '../../src/server/webrtc-vad.js'

const frame = (value: number, samples = 160) =>
  Buffer.from(new Int16Array(samples).fill(value).buffer)

describe('WebRTC utterance VAD', () => {
  test('cuts utterances when speech is followed by sustained silence', () => {
    const vad = createWebRtcUtteranceVad({
      minSpeechMs: 20,
      silenceMs: 40,
      speechRmsThreshold: 0.02,
    })
    const utterances: Buffer[] = []

    for (let index = 0; index < 3; index += 1) {
      const result = vad.push({
        bitsPerSample: 16,
        channelCount: 1,
        pcm: frame(4000),
        sampleRate: 16_000,
      })
      if (result) utterances.push(result.pcm)
    }
    for (let index = 0; index < 4; index += 1) {
      const result = vad.push({
        bitsPerSample: 16,
        channelCount: 1,
        pcm: frame(0),
        sampleRate: 16_000,
      })
      if (result) utterances.push(result.pcm)
    }
    for (let index = 0; index < 2; index += 1) {
      const result = vad.push({
        bitsPerSample: 16,
        channelCount: 1,
        pcm: frame(5000),
        sampleRate: 16_000,
      })
      if (result) utterances.push(result.pcm)
    }
    for (let index = 0; index < 4; index += 1) {
      const result = vad.push({
        bitsPerSample: 16,
        channelCount: 1,
        pcm: frame(0),
        sampleRate: 16_000,
      })
      if (result) utterances.push(result.pcm)
    }

    expect(utterances).toHaveLength(2)
    expect(utterances[0]?.byteLength).toBe(3 * 160 * 2)
    expect(utterances[1]?.byteLength).toBe(2 * 160 * 2)
  })

  test('does not emit short noise bursts as utterances', () => {
    const vad = createWebRtcUtteranceVad({
      minSpeechMs: 30,
      silenceMs: 20,
      speechRmsThreshold: 0.02,
    })

    const emitted = [
      vad.push({ bitsPerSample: 16, channelCount: 1, pcm: frame(5000), sampleRate: 16_000 }),
      vad.push({ bitsPerSample: 16, channelCount: 1, pcm: frame(0), sampleRate: 16_000 }),
      vad.push({ bitsPerSample: 16, channelCount: 1, pcm: frame(0), sampleRate: 16_000 }),
    ].filter(Boolean)

    expect(emitted).toHaveLength(0)
  })

  test('does not force-flush speech shorter than the minimum duration', () => {
    const vad = createWebRtcUtteranceVad({
      minSpeechMs: 30,
      silenceMs: 100,
      speechRmsThreshold: 0.02,
    })

    vad.push({ bitsPerSample: 16, channelCount: 1, pcm: frame(5000), sampleRate: 16_000 })

    expect(vad.flush({ force: true })).toBeNull()
  })

  test('force-flushes an active utterance that meets the minimum duration', () => {
    const vad = createWebRtcUtteranceVad({
      minSpeechMs: 20,
      silenceMs: 100,
      speechRmsThreshold: 0.02,
    })

    vad.push({ bitsPerSample: 16, channelCount: 1, pcm: frame(5000), sampleRate: 16_000 })
    vad.push({ bitsPerSample: 16, channelCount: 1, pcm: frame(5000), sampleRate: 16_000 })

    const utterance = vad.flush({ force: true })

    expect(utterance?.pcm.byteLength).toBe(2 * 160 * 2)
  })
})
