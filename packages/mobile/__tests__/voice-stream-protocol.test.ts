import { describe, expect, test } from 'vitest'

import {
  calculateVoiceStreamLatency,
  createVoiceStreamFrame,
  isVoiceStreamFrame,
  nextVoiceStreamId,
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
})
