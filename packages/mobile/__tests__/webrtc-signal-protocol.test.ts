import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  createWebRtcSignalFrame,
  isWebRtcSignalFrame,
  nextWebRtcCallId,
} from '../src/api/webrtc-signal-protocol.js'

describe('WebRTC signal protocol', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('recognizes offer answer ice bye frames and rejects RPC or voice stream frames', () => {
    expect(
      isWebRtcSignalFrame({
        call_id: 'call-1',
        kind: 'offer',
        sdp: 'v=0',
        sdp_type: 'offer',
        type: 'webrtc_signal',
      })
    ).toBe(true)
    expect(
      isWebRtcSignalFrame({
        call_id: 'call-1',
        candidate: { candidate: 'candidate:1', sdpMLineIndex: 0, sdpMid: '0' },
        kind: 'ice',
        type: 'webrtc_signal',
      })
    ).toBe(true)
    expect(isWebRtcSignalFrame({ call_id: 'call-1', kind: 'bye', type: 'webrtc_signal' })).toBe(
      true
    )

    expect(isWebRtcSignalFrame({ id: 'rpc-1', jsonrpc: '2.0', method: 'runtime.status' })).toBe(
      false
    )
    expect(
      isWebRtcSignalFrame({ op: 'open', seq: 0, stream_id: 'voice-1', type: 'voice_stream' })
    ).toBe(false)
    expect(isWebRtcSignalFrame({ call_id: '', kind: 'offer', type: 'webrtc_signal' })).toBe(false)
    expect(isWebRtcSignalFrame({ call_id: 'call-1', kind: 'open', type: 'webrtc_signal' })).toBe(
      false
    )
  })

  test('creates stable call ids and signal frames', () => {
    expect(nextWebRtcCallId(1_700_000_000_000, () => 'uuid-1')).toBe('webrtc-1700000000000-uuid-1')
    expect(
      createWebRtcSignalFrame('answer', 'call-1', {
        sdp: 'v=0',
        sent_at_ms: 1_234,
      })
    ).toEqual({
      call_id: 'call-1',
      kind: 'answer',
      sdp: 'v=0',
      sdp_type: 'answer',
      sent_at_ms: 1_234,
      type: 'webrtc_signal',
    })
  })

  test('creates call ids with getRandomValues when randomUUID is unavailable on RN', () => {
    const realGetRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
    vi.stubGlobal('crypto', { getRandomValues: realGetRandomValues })

    expect(() => nextWebRtcCallId(1_700_000_000_000)).not.toThrow()
    expect(nextWebRtcCallId(1_700_000_000_000)).toMatch(
      /^webrtc-1700000000000-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })
})
