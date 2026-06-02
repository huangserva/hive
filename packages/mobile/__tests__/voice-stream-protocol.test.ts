import { describe, expect, test } from 'vitest'

import {
  calculateVoiceStreamLatency,
  createVoiceStreamFrame,
  createVoiceStreamReassembler,
  isVoiceStreamFrame,
  nextVoiceStreamId,
  splitAudioBase64ToVoiceStreamFrames,
} from '../src/api/voice-stream-protocol.js'

describe('voice stream protocol', () => {
  test('recognizes valid voice_stream frames and rejects JSON-RPC frames', () => {
    expect(
      isVoiceStreamFrame({
        op: 'chunk',
        payload: 'ping',
        sent_at_ms: 1_000,
        seq: 7,
        stream_id: 'voice-1',
        type: 'voice_stream',
      })
    ).toBe(true)

    expect(isVoiceStreamFrame({ id: 'rpc-1', jsonrpc: '2.0', method: 'runtime.status' })).toBe(
      false
    )
    expect(
      isVoiceStreamFrame({ op: 'chunk', seq: -1, stream_id: 'voice-1', type: 'voice_stream' })
    ).toBe(false)
  })

  test('builds ordered open, chunk, ack, close lifecycle frames', () => {
    const streamId = nextVoiceStreamId(1_700_000_000_000)

    expect(createVoiceStreamFrame('open', streamId, 0)).toMatchObject({
      op: 'open',
      seq: 0,
      stream_id: streamId,
      type: 'voice_stream',
    })
    expect(createVoiceStreamFrame('chunk', streamId, 1, { payload: 'ping' })).toMatchObject({
      op: 'chunk',
      payload: 'ping',
      seq: 1,
    })
    expect(createVoiceStreamFrame('ack', streamId, 1, { sent_at_ms: 1_234 })).toMatchObject({
      op: 'ack',
      sent_at_ms: 1_234,
      seq: 1,
    })
    expect(createVoiceStreamFrame('close', streamId, 2)).toMatchObject({
      op: 'close',
      seq: 2,
    })
  })

  test('calculates p50 p95 max RTT and lost frames from acknowledged samples', () => {
    expect(
      calculateVoiceStreamLatency({
        expectedCount: 5,
        rtts: [12, 40, 20, 90],
        streamId: 'voice-1',
      })
    ).toEqual({
      count: 5,
      lost: 1,
      max_ms: 90,
      p50_ms: 20,
      p95_ms: 90,
      received: 4,
      stream_id: 'voice-1',
    })
  })

  test('splits audio into ordered chunk frames and marks the final chunk done', () => {
    const frames = splitAudioBase64ToVoiceStreamFrames({
      chunkSize: 4,
      format: 'm4a',
      mime: 'audio/mp4',
      payload: 'abcdefghijkl',
      startSeq: 2,
      streamId: 'voice-audio',
    })

    expect(frames).toEqual([
      expect.objectContaining({ done: false, payload: 'abcd', seq: 2 }),
      expect.objectContaining({ done: false, payload: 'efgh', seq: 3 }),
      expect.objectContaining({
        done: true,
        format: 'm4a',
        mime: 'audio/mp4',
        payload: 'ijkl',
        seq: 4,
      }),
    ])
  })

  test('reassembles out-of-order audio chunks only when the done frame closes the sequence', () => {
    const reassembler = createVoiceStreamReassembler('voice-audio')

    expect(
      reassembler.accept(
        createVoiceStreamFrame('chunk', 'voice-audio', 2, {
          done: true,
          format: 'm4a',
          mime: 'audio/mp4',
          payload: 'cccc',
        })
      )
    ).toBeNull()
    expect(
      reassembler.accept(
        createVoiceStreamFrame('chunk', 'voice-audio', 0, {
          done: false,
          payload: 'aaaa',
        })
      )
    ).toBeNull()
    expect(
      reassembler.accept(
        createVoiceStreamFrame('chunk', 'voice-audio', 1, {
          done: false,
          payload: 'bbbb',
        })
      )
    ).toEqual({
      audio: 'aaaabbbbcccc',
      format: 'm4a',
      mime: 'audio/mp4',
      stream_id: 'voice-audio',
    })
  })
})
