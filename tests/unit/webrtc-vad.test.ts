import { describe, expect, test } from 'vitest'

import {
  createWebRtcUtteranceVad,
  resolveWebRtcBargeRmsThreshold,
} from '../../src/server/webrtc-vad.js'

const frame = (value: number, samples = 160) =>
  Buffer.from(new Int16Array(samples).fill(value).buffer)

const frameWithRms = (rms: number, samples = 160) => frame(Math.round(rms * 32768), samples)

describe('WebRTC utterance VAD', () => {
  test('defaults barge-in onset threshold high enough to reject residual echo and accept real speech', () => {
    const echoStarts: number[] = []
    const echoVad = createWebRtcUtteranceVad({
      minSpeechMs: 20,
      onSpeechStart: () => echoStarts.push(1),
      silenceMs: 40,
      speechStartConfirmationFrames: 3,
    })

    for (let index = 0; index < 3; index += 1) {
      echoVad.push({
        bitsPerSample: 16,
        channelCount: 1,
        pcm: frameWithRms(0.017),
        sampleRate: 16_000,
      })
    }

    const speechStarts: number[] = []
    const speechVad = createWebRtcUtteranceVad({
      minSpeechMs: 20,
      onSpeechStart: () => speechStarts.push(1),
      silenceMs: 40,
      speechStartConfirmationFrames: 3,
    })

    for (let index = 0; index < 3; index += 1) {
      speechVad.push({
        bitsPerSample: 16,
        channelCount: 1,
        pcm: frameWithRms(0.06),
        sampleRate: 16_000,
      })
    }

    expect(echoStarts).toEqual([])
    expect(speechStarts).toEqual([1])
  })

  test('allows the WebRTC barge-in RMS threshold to be tuned by environment', () => {
    expect(
      resolveWebRtcBargeRmsThreshold({
        HIVE_WEBRTC_BARGE_RMS_THRESHOLD: '0.041',
      })
    ).toBe(0.041)
    expect(
      resolveWebRtcBargeRmsThreshold({
        HIVE_WEBRTC_BARGE_RMS_THRESHOLD: 'not-a-number',
      })
    ).toBe(0.03)
  })

  test('captures normal-volume speech below the old loud-only RMS threshold', () => {
    const vad = createWebRtcUtteranceVad({
      minSpeechMs: 20,
      silenceMs: 40,
      speechRmsThreshold: 0.006,
    })
    const utterances: Buffer[] = []

    for (let index = 0; index < 3; index += 1) {
      const result = vad.push({
        bitsPerSample: 16,
        channelCount: 1,
        pcm: frame(220),
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

    expect(utterances).toHaveLength(1)
  })

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

  test('reports utterance average and peak RMS for threshold tuning', () => {
    const vad = createWebRtcUtteranceVad({
      minSpeechMs: 20,
      silenceMs: 40,
      speechRmsThreshold: 0.005,
    })

    vad.push({ bitsPerSample: 16, channelCount: 1, pcm: frame(220), sampleRate: 16_000 })
    vad.push({ bitsPerSample: 16, channelCount: 1, pcm: frame(440), sampleRate: 16_000 })
    let utterance = null
    for (let index = 0; index < 4; index += 1) {
      utterance = vad.push({
        bitsPerSample: 16,
        channelCount: 1,
        pcm: frame(0),
        sampleRate: 16_000,
      })
    }

    expect(utterance?.averageRms).toBeGreaterThan(0.009)
    expect(utterance?.averageRms).toBeLessThan(0.011)
    expect(utterance?.peakRms).toBeGreaterThan(0.013)
  })

  test('fires speech-start once after short confirmation and again after silence', () => {
    const speechStarts: number[] = []
    const vad = createWebRtcUtteranceVad({
      minSpeechMs: 20,
      onSpeechStart: () => {
        speechStarts.push(speechStarts.length + 1)
      },
      silenceMs: 30,
      speechRmsThreshold: 0.006,
      speechStartConfirmationFrames: 2,
    })

    vad.push({ bitsPerSample: 16, channelCount: 1, pcm: frame(220), sampleRate: 16_000 })
    expect(speechStarts).toEqual([])
    vad.push({ bitsPerSample: 16, channelCount: 1, pcm: frame(220), sampleRate: 16_000 })
    expect(speechStarts).toEqual([1])
    vad.push({ bitsPerSample: 16, channelCount: 1, pcm: frame(220), sampleRate: 16_000 })
    expect(speechStarts).toEqual([1])

    for (let index = 0; index < 3; index += 1) {
      vad.push({ bitsPerSample: 16, channelCount: 1, pcm: frame(0), sampleRate: 16_000 })
    }
    vad.push({ bitsPerSample: 16, channelCount: 1, pcm: frame(220), sampleRate: 16_000 })
    expect(speechStarts).toEqual([1])
    vad.push({ bitsPerSample: 16, channelCount: 1, pcm: frame(220), sampleRate: 16_000 })
    expect(speechStarts).toEqual([1, 2])
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
