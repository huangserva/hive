import { afterEach, describe, expect, test, vi } from 'vitest'

import { createWebRtcCallee } from '../../src/server/webrtc-callee.js'
import type { WebRtcSignalFrame } from '../../src/server/webrtc-signal-protocol.js'

class FakePeerConnection {
  localDescription: { sdp: string; type: 'answer' } | null = null
  connectionState = 'new'
  onicecandidate: ((event: { candidate: unknown | null }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  ontrack: ((event: { receiver?: unknown; streams?: unknown[]; track?: unknown }) => void) | null =
    null
  remoteDescription: unknown = null
  addedCandidates: unknown[] = []
  closed = false

  constructor(readonly config: unknown) {}

  async setRemoteDescription(description: unknown) {
    this.remoteDescription = description
  }

  async createAnswer() {
    return { sdp: 'answer-sdp', type: 'answer' as const }
  }

  async setLocalDescription(description: { sdp: string; type: 'answer' }) {
    this.localDescription = description
  }

  async addIceCandidate(candidate: unknown) {
    this.addedCandidates.push(candidate)
  }

  close() {
    this.closed = true
  }
}

describe('WebRTC callee', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('answers an offer and emits trickle ICE without using JSON-RPC', async () => {
    const sent: WebRtcSignalFrame[] = []
    const peers: FakePeerConnection[] = []
    const callee = createWebRtcCallee({
      getIceServers: async () => [{ urls: 'turn:turn.example.test:443' }],
      loadRuntime: async () => ({
        RTCPeerConnection: class extends FakePeerConnection {
          constructor(config: unknown) {
            super(config)
            peers.push(this)
          }
        },
      }),
    })

    await expect(
      callee.handleSignal(
        {
          call_id: 'call-1',
          kind: 'offer',
          sdp: 'offer-sdp',
          sdp_type: 'offer',
          type: 'webrtc_signal',
        },
        { send: (frame) => sent.push(frame) }
      )
    ).resolves.toBe(true)

    expect(peers).toHaveLength(1)
    expect(peers[0]?.config).toEqual({ iceServers: [{ urls: 'turn:turn.example.test:443' }] })
    expect(peers[0]?.remoteDescription).toEqual({ sdp: 'offer-sdp', type: 'offer' })
    expect(sent).toEqual([
      expect.objectContaining({
        call_id: 'call-1',
        kind: 'answer',
        sdp: 'answer-sdp',
        sdp_type: 'answer',
        type: 'webrtc_signal',
      }),
    ])

    peers[0]?.onicecandidate?.({
      candidate: { candidate: 'candidate:1', sdpMLineIndex: 0, sdpMid: '0' },
    })
    expect(sent.at(-1)).toMatchObject({
      call_id: 'call-1',
      candidate: { candidate: 'candidate:1', sdpMLineIndex: 0, sdpMid: '0' },
      kind: 'ice',
      type: 'webrtc_signal',
    })
  })

  test('adds remote ice candidates and closes calls on bye', async () => {
    const peers: FakePeerConnection[] = []
    const callee = createWebRtcCallee({
      getIceServers: async () => [],
      loadRuntime: async () => ({
        RTCPeerConnection: class extends FakePeerConnection {
          constructor(config: unknown) {
            super(config)
            peers.push(this)
          }
        },
      }),
    })

    await callee.handleSignal(
      {
        call_id: 'call-1',
        kind: 'offer',
        sdp: 'offer-sdp',
        sdp_type: 'offer',
        type: 'webrtc_signal',
      },
      { send: () => {} }
    )
    await callee.handleSignal(
      {
        call_id: 'call-1',
        candidate: { candidate: 'candidate:2', sdpMLineIndex: 0, sdpMid: '0' },
        kind: 'ice',
        type: 'webrtc_signal',
      },
      { send: () => {} }
    )
    await callee.handleSignal(
      { call_id: 'call-1', kind: 'bye', type: 'webrtc_signal' },
      { send: () => {} }
    )

    expect(peers[0]?.addedCandidates).toEqual([
      { candidate: 'candidate:2', sdpMLineIndex: 0, sdpMid: '0' },
    ])
    expect(peers[0]?.closed).toBe(true)
  })

  test('closes unanswered calls after the configured timeout', async () => {
    vi.useFakeTimers()
    const peers: FakePeerConnection[] = []
    const callee = createWebRtcCallee({
      callTimeoutMs: 30_000,
      getIceServers: async () => [],
      loadRuntime: async () => ({
        RTCPeerConnection: class extends FakePeerConnection {
          constructor(config: unknown) {
            super(config)
            peers.push(this)
          }
        },
      }),
    })

    await callee.handleSignal(
      {
        call_id: 'call-timeout',
        kind: 'offer',
        sdp: 'offer-sdp',
        sdp_type: 'offer',
        type: 'webrtc_signal',
      },
      { send: () => {} }
    )

    expect(peers[0]?.closed).toBe(false)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(peers[0]?.closed).toBe(true)
  })

  test('closes and forgets a peer when offer initialization throws', async () => {
    const peers: FakePeerConnection[] = []
    class ThrowingPeerConnection extends FakePeerConnection {
      async setRemoteDescription() {
        throw new Error('bad offer')
      }
    }
    const callee = createWebRtcCallee({
      getIceServers: async () => [],
      loadRuntime: async () => ({
        RTCPeerConnection: class extends ThrowingPeerConnection {
          constructor(config: unknown) {
            super(config)
            peers.push(this)
          }
        },
      }),
    })

    await expect(
      callee.handleSignal(
        {
          call_id: 'call-bad-offer',
          kind: 'offer',
          sdp: 'offer-sdp',
          sdp_type: 'offer',
          type: 'webrtc_signal',
        },
        { send: () => {} }
      )
    ).rejects.toThrow('bad offer')

    expect(peers[0]?.closed).toBe(true)

    await callee.handleSignal(
      {
        call_id: 'call-bad-offer',
        candidate: { candidate: 'candidate:after-error' },
        kind: 'ice',
        type: 'webrtc_signal',
      },
      { send: () => {} }
    )
    expect(peers[0]?.addedCandidates).toEqual([])
  })

  test('starts an upstream audio session for remote audio tracks and closes it on bye', async () => {
    const peers: FakePeerConnection[] = []
    const closedSessions: string[] = []
    const startedTracks: unknown[] = []
    const callee = createWebRtcCallee({
      audioSink: {
        start: ({ callId, track }) => {
          startedTracks.push(track)
          return {
            close: () => {
              closedSessions.push(callId)
            },
          }
        },
      },
      getIceServers: async () => [],
      loadRuntime: async () => ({
        RTCPeerConnection: class extends FakePeerConnection {
          constructor(config: unknown) {
            super(config)
            peers.push(this)
          }
        },
      }),
    })

    await callee.handleSignal(
      {
        call_id: 'call-audio',
        kind: 'offer',
        sdp: 'offer-sdp',
        sdp_type: 'offer',
        type: 'webrtc_signal',
        workspace_id: 'workspace-1',
      },
      { send: () => {} }
    )
    const audioTrack = { kind: 'audio' }
    peers[0]?.ontrack?.({ receiver: { id: 'receiver-1' }, streams: [], track: audioTrack })
    await callee.handleSignal(
      { call_id: 'call-audio', kind: 'bye', type: 'webrtc_signal' },
      { send: () => {} }
    )

    expect(startedTracks).toEqual([audioTrack])
    expect(closedSessions).toEqual(['call-audio'])
  })

  test('closes and forgets a peer when addIceCandidate throws', async () => {
    const peers: FakePeerConnection[] = []
    class ThrowingIcePeerConnection extends FakePeerConnection {
      async addIceCandidate() {
        throw new Error('bad candidate')
      }
    }
    const callee = createWebRtcCallee({
      getIceServers: async () => [],
      loadRuntime: async () => ({
        RTCPeerConnection: class extends ThrowingIcePeerConnection {
          constructor(config: unknown) {
            super(config)
            peers.push(this)
          }
        },
      }),
    })

    await callee.handleSignal(
      {
        call_id: 'call-bad-ice',
        kind: 'offer',
        sdp: 'offer-sdp',
        sdp_type: 'offer',
        type: 'webrtc_signal',
      },
      { send: () => {} }
    )
    await expect(
      callee.handleSignal(
        {
          call_id: 'call-bad-ice',
          candidate: { candidate: 'candidate:bad' },
          kind: 'ice',
          type: 'webrtc_signal',
        },
        { send: () => {} }
      )
    ).rejects.toThrow('bad candidate')
    expect(peers[0]?.closed).toBe(true)

    await callee.handleSignal(
      {
        call_id: 'call-bad-ice',
        candidate: { candidate: 'candidate:after-error' },
        kind: 'ice',
        type: 'webrtc_signal',
      },
      { send: () => {} }
    )
    expect(peers[0]?.addedCandidates).toEqual([])
  })

  test('closes and forgets a peer when connection state fails or closes', async () => {
    const peers: FakePeerConnection[] = []
    const callee = createWebRtcCallee({
      getIceServers: async () => [],
      loadRuntime: async () => ({
        RTCPeerConnection: class extends FakePeerConnection {
          constructor(config: unknown) {
            super(config)
            peers.push(this)
          }
        },
      }),
    })

    await callee.handleSignal(
      {
        call_id: 'call-failed',
        kind: 'offer',
        sdp: 'offer-sdp',
        sdp_type: 'offer',
        type: 'webrtc_signal',
      },
      { send: () => {} }
    )
    const peer = peers[0]
    expect(peer).toBeDefined()
    if (!peer) throw new Error('peer connection was not created')
    peer.connectionState = 'failed'
    peer.onconnectionstatechange?.()
    expect(peer.closed).toBe(true)

    await callee.handleSignal(
      {
        call_id: 'call-failed',
        candidate: { candidate: 'candidate:after-failed' },
        kind: 'ice',
        type: 'webrtc_signal',
      },
      { send: () => {} }
    )
    expect(peer.addedCandidates).toEqual([])
  })
})
