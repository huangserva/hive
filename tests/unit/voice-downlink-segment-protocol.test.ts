import { describe, expect, test } from 'vitest'

import {
  createVoiceDownlinkSegmentReassembler,
  createVoiceDownlinkSegmentReassemblerCache,
  isVoiceDownlinkSegmentFrame,
  splitAudioBase64ToVoiceDownlinkSegmentFrames,
} from '../../src/server/voice-downlink-segment-protocol.js'

describe('voice downlink segment protocol', () => {
  test('splits and reassembles a single TTS file segment with call and generation metadata', () => {
    const frames = splitAudioBase64ToVoiceDownlinkSegmentFrames({
      audio: 'abcdefghij',
      callId: 'call-1',
      chunkSize: 4,
      format: 'mp3',
      generation: 7,
      isFinal: true,
      mime: 'audio/mpeg',
      segmentId: 1,
      text: '你好',
      turnId: 'turn-1',
    })

    expect(frames.map((frame) => frame.op)).toEqual([
      'segment_open',
      'segment_chunk',
      'segment_chunk',
      'segment_chunk',
    ])
    expect(frames.every(isVoiceDownlinkSegmentFrame)).toBe(true)
    expect(frames[0]).toMatchObject({
      call_id: 'call-1',
      generation: 7,
      is_final: true,
      segment_id: 1,
      text: '你好',
      turn_id: 'turn-1',
      type: 'voice_downlink_segment',
    })

    const reassembler = createVoiceDownlinkSegmentReassembler({
      callId: 'call-1',
      generation: 7,
      segmentId: 1,
      turnId: 'turn-1',
    })
    const results = frames.map((frame) => reassembler.accept(frame)).filter(Boolean)

    expect(results).toEqual([
      {
        audio: 'abcdefghij',
        call_id: 'call-1',
        format: 'mp3',
        generation: 7,
        is_final: true,
        mime: 'audio/mpeg',
        segment_id: 1,
        text: '你好',
        turn_id: 'turn-1',
      },
    ])
  })

  test('evicts incomplete segment reassemblers by TTL and max entries', () => {
    const cache = createVoiceDownlinkSegmentReassemblerCache({ maxEntries: 2, ttlMs: 100 })

    cache.accept(
      {
        call_id: 'call-1',
        generation: 0,
        op: 'segment_chunk',
        payload: 'a',
        segment_id: 1,
        seq: 1,
        turn_id: 'turn-1',
        type: 'voice_downlink_segment',
      },
      0
    )
    cache.accept(
      {
        call_id: 'call-1',
        generation: 0,
        op: 'segment_chunk',
        payload: 'b',
        segment_id: 2,
        seq: 1,
        turn_id: 'turn-2',
        type: 'voice_downlink_segment',
      },
      10
    )
    expect(cache.size()).toBe(2)

    cache.accept(
      {
        call_id: 'call-1',
        generation: 0,
        op: 'segment_chunk',
        payload: 'c',
        segment_id: 3,
        seq: 1,
        turn_id: 'turn-3',
        type: 'voice_downlink_segment',
      },
      20
    )
    expect(cache.size()).toBe(2)

    cache.cleanup(121)
    expect(cache.size()).toBe(0)
  })

  test('drops older incomplete generations when a newer generation arrives', () => {
    const cache = createVoiceDownlinkSegmentReassemblerCache({ maxEntries: 8, ttlMs: 10_000 })
    const base = {
      call_id: 'call-1',
      op: 'segment_chunk' as const,
      payload: 'a',
      segment_id: 1,
      seq: 1,
      turn_id: 'turn-1',
      type: 'voice_downlink_segment' as const,
    }
    cache.accept({ ...base, generation: 1 }, 0)
    expect(cache.size()).toBe(1)
    cache.accept({ ...base, generation: 2 }, 1)
    expect(cache.size()).toBe(1)
  })
})
