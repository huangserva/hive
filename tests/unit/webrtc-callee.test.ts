import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  createWebRtcCallee,
  resolveWebRtcForceRelayEnabled,
} from '../../src/server/webrtc-callee.js'
import type { WebRtcSignalFrame } from '../../src/server/webrtc-signal-protocol.js'

class FakePeerConnection {
  addedTracks: unknown[] = []
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

  addTrack(track: unknown) {
    this.addedTracks.push(track)
  }

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
    vi.unstubAllEnvs()
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

  test('forces relay-only ICE when HIVE_WEBRTC_FORCE_RELAY is enabled', async () => {
    vi.stubEnv('HIVE_WEBRTC_FORCE_RELAY', '1')
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

    await callee.handleSignal(
      {
        call_id: 'call-relay',
        kind: 'offer',
        sdp: 'offer-sdp',
        sdp_type: 'offer',
        type: 'webrtc_signal',
      },
      { send: () => {} }
    )

    expect(peers[0]?.config).toEqual({
      iceServers: [{ urls: 'turn:turn.example.test:443' }],
      iceTransportPolicy: 'relay',
    })
  })

  test('parses force-relay env flag case-insensitively and accepts boolean true', () => {
    expect(resolveWebRtcForceRelayEnabled({ HIVE_WEBRTC_FORCE_RELAY: 'TRUE' })).toBe(true)
    expect(resolveWebRtcForceRelayEnabled({ HIVE_WEBRTC_FORCE_RELAY: ' True ' })).toBe(true)
    expect(resolveWebRtcForceRelayEnabled({ HIVE_WEBRTC_FORCE_RELAY: true })).toBe(true)
    expect(resolveWebRtcForceRelayEnabled({ HIVE_WEBRTC_FORCE_RELAY: undefined })).toBe(false)
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

  test('adds a local downlink audio track for the call and closes it on bye', async () => {
    const peers: FakePeerConnection[] = []
    const stoppedTracks: string[] = []
    const localTrack = {
      kind: 'audio',
      stop: () => {
        stoppedTracks.push('downlink')
      },
    }
    const callee = createWebRtcCallee({
      downlinkAudio: {
        startCall: async () => ({
          close: () => {
            localTrack.stop()
          },
          track: localTrack,
        }),
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
        call_id: 'call-downlink',
        kind: 'offer',
        sdp: 'offer-sdp',
        sdp_type: 'offer',
        type: 'webrtc_signal',
        workspace_id: 'workspace-1',
      },
      { send: () => {} }
    )

    expect(peers[0]?.addedTracks).toEqual([localTrack])

    await callee.handleSignal(
      { call_id: 'call-downlink', kind: 'bye', type: 'webrtc_signal' },
      { send: () => {} }
    )

    expect(stoppedTracks).toEqual(['downlink'])
  })

  test('closes and forgets a peer immediately when downlink start fails', async () => {
    const sent: WebRtcSignalFrame[] = []
    const peers: FakePeerConnection[] = []
    const callee = createWebRtcCallee({
      downlinkAudio: {
        startCall: async () => {
          throw new Error('downlink unavailable')
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

    await expect(
      callee.handleSignal(
        {
          call_id: 'call-downlink-start-fails',
          kind: 'offer',
          sdp: 'offer-sdp',
          sdp_type: 'offer',
          type: 'webrtc_signal',
          workspace_id: 'workspace-1',
        },
        { send: (frame) => sent.push(frame) }
      )
    ).resolves.toBe(true)

    expect(peers[0]?.closed).toBe(true)
    expect(sent).toEqual([
      { call_id: 'call-downlink-start-fails', kind: 'bye', type: 'webrtc_signal' },
    ])

    await callee.handleSignal(
      {
        call_id: 'call-downlink-start-fails',
        candidate: { candidate: 'candidate:after-downlink-fail' },
        kind: 'ice',
        type: 'webrtc_signal',
      },
      { send: (frame) => sent.push(frame) }
    )
    expect(peers[0]?.addedCandidates).toEqual([])
  })

  test('closes downlink session and peer immediately when adding the local track fails', async () => {
    const sent: WebRtcSignalFrame[] = []
    const peers: FakePeerConnection[] = []
    const closedDownlinkSessions: string[] = []
    const localTrack = { kind: 'audio' }
    class ThrowingAddTrackPeerConnection extends FakePeerConnection {
      addTrack() {
        throw new Error('addTrack failed')
      }
    }
    const callee = createWebRtcCallee({
      downlinkAudio: {
        startCall: async () => ({
          close: () => {
            closedDownlinkSessions.push('closed')
          },
          track: localTrack,
        }),
      },
      getIceServers: async () => [],
      loadRuntime: async () => ({
        RTCPeerConnection: class extends ThrowingAddTrackPeerConnection {
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
          call_id: 'call-add-track-fails',
          kind: 'offer',
          sdp: 'offer-sdp',
          sdp_type: 'offer',
          type: 'webrtc_signal',
          workspace_id: 'workspace-1',
        },
        { send: (frame) => sent.push(frame) }
      )
    ).resolves.toBe(true)

    expect(closedDownlinkSessions).toEqual(['closed'])
    expect(peers[0]?.closed).toBe(true)
    expect(sent).toEqual([{ call_id: 'call-add-track-fails', kind: 'bye', type: 'webrtc_signal' }])
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
