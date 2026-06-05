import { describe, expect, test } from 'vitest'
import type { WebRtcSignalFrame } from '../src/api/webrtc-signal-protocol.js'
import { createWebRtcCaller, resolveWebRtcForceRelayEnabled } from '../src/lib/webrtc-caller.js'
import { runWebRtcConnectionProbeSession } from '../src/lib/webrtc-connection-probe.js'

class FakePeerConnection {
  addedTracks: Array<{ stream: unknown; track: unknown }> = []
  localDescription: unknown = null
  connectionState = 'new'
  onconnectionstatechange: (() => void) | null = null
  onicecandidate: ((event: { candidate: unknown | null }) => void) | null = null
  ontrack: ((event: { streams?: unknown[]; track?: unknown }) => void) | null = null
  remoteDescription: unknown = null
  addedCandidates: unknown[] = []
  closed = false

  constructor(readonly config: unknown) {}

  addTrack(track: unknown, stream: unknown) {
    this.addedTracks.push({ stream, track })
  }

  async createOffer() {
    return { sdp: 'offer-sdp', type: 'offer' as const }
  }

  async setLocalDescription(description: unknown) {
    this.localDescription = description
  }

  async setRemoteDescription(description: unknown) {
    this.remoteDescription = description
  }

  async addIceCandidate(candidate: unknown) {
    this.addedCandidates.push(candidate)
  }

  close() {
    this.closed = true
  }
}

describe('WebRTC caller', () => {
  test('fetches ICE config, sends offer, and handles answer/ice/bye frames', async () => {
    const sent: WebRtcSignalFrame[] = []
    const listeners: Array<(frame: WebRtcSignalFrame) => void> = []
    const peers: FakePeerConnection[] = []
    const caller = createWebRtcCaller({
      loadRuntime: async () => ({
        RTCPeerConnection: class extends FakePeerConnection {
          constructor(config: unknown) {
            super(config)
            peers.push(this)
          }
        },
      }),
      nextCallId: () => 'call-1',
      transport: {
        call: async <T>(method: string): Promise<T> => {
          expect(method).toBe('voice.webrtc.iceConfig')
          return { iceServers: [{ urls: 'turn:turn.example.test:443' }] } as T
        },
        onWebRtcSignalFrame: (listener) => {
          listeners.push(listener)
          return () => {}
        },
        sendWebRtcSignalFrame: (frame) => sent.push(frame),
      },
    })

    const session = await caller.start()

    expect(session.callId).toBe('call-1')
    expect(peers).toHaveLength(1)
    expect(peers[0]?.config).toEqual({ iceServers: [{ urls: 'turn:turn.example.test:443' }] })
    expect(sent[0]).toMatchObject({
      call_id: 'call-1',
      kind: 'offer',
      sdp: 'offer-sdp',
      sdp_type: 'offer',
      type: 'webrtc_signal',
    })

    peers[0]?.onicecandidate?.({
      candidate: { candidate: 'candidate:local', sdpMLineIndex: 0, sdpMid: '0' },
    })
    expect(sent.at(-1)).toMatchObject({
      call_id: 'call-1',
      candidate: { candidate: 'candidate:local', sdpMLineIndex: 0, sdpMid: '0' },
      kind: 'ice',
    })

    await listeners[0]?.({
      call_id: 'call-1',
      kind: 'answer',
      sdp: 'answer-sdp',
      sdp_type: 'answer',
      type: 'webrtc_signal',
    })
    await listeners[0]?.({
      call_id: 'call-1',
      candidate: { candidate: 'candidate:remote', sdpMLineIndex: 0, sdpMid: '0' },
      kind: 'ice',
      type: 'webrtc_signal',
    })
    await listeners[0]?.({ call_id: 'call-1', kind: 'bye', type: 'webrtc_signal' })

    expect(peers[0]?.remoteDescription).toEqual({ sdp: 'answer-sdp', type: 'answer' })
    expect(peers[0]?.addedCandidates).toEqual([
      { candidate: 'candidate:remote', sdpMLineIndex: 0, sdpMid: '0' },
    ])
    expect(peers[0]?.closed).toBe(true)
  })

  test('forces relay-only ICE when caller forceRelay option is enabled', async () => {
    const peers: FakePeerConnection[] = []
    const caller = createWebRtcCaller({
      forceRelay: true,
      loadRuntime: async () => ({
        RTCPeerConnection: class extends FakePeerConnection {
          constructor(config: unknown) {
            super(config)
            peers.push(this)
          }
        },
      }),
      nextCallId: () => 'call-relay-only',
      transport: {
        call: async <T>(): Promise<T> =>
          ({ iceServers: [{ urls: 'turn:turn.example.test:443' }] }) as T,
        onWebRtcSignalFrame: () => () => {},
        sendWebRtcSignalFrame: () => {},
      },
    })

    await caller.start()

    expect(peers[0]?.config).toEqual({
      iceServers: [{ urls: 'turn:turn.example.test:443' }],
      iceTransportPolicy: 'relay',
    })
  })

  test('parses force-relay flag case-insensitively and accepts boolean true', () => {
    expect(resolveWebRtcForceRelayEnabled({ webRtcForceRelay: 'TRUE' }, {})).toBe(true)
    expect(resolveWebRtcForceRelayEnabled({ webRtcForceRelay: ' True ' }, {})).toBe(true)
    expect(resolveWebRtcForceRelayEnabled({ webRtcForceRelay: true }, {})).toBe(true)
    expect(
      resolveWebRtcForceRelayEnabled(undefined, { EXPO_PUBLIC_WEBRTC_FORCE_RELAY: 'TRUE' })
    ).toBe(true)
    expect(resolveWebRtcForceRelayEnabled(undefined, {})).toBe(false)
  })

  test('resolves waitForConnected when the peer connection reaches connected', async () => {
    const listeners: Array<(frame: WebRtcSignalFrame) => void | Promise<void>> = []
    const peers: FakePeerConnection[] = []
    const caller = createWebRtcCaller({
      loadRuntime: async () => ({
        RTCPeerConnection: class extends FakePeerConnection {
          constructor(config: unknown) {
            super(config)
            peers.push(this)
          }
        },
      }),
      nextCallId: () => 'call-2',
      transport: {
        call: async <T>(): Promise<T> =>
          ({ iceServers: [{ urls: 'turn:turn.example.test:443' }] }) as T,
        onWebRtcSignalFrame: (listener) => {
          listeners.push(listener)
          return () => {}
        },
        sendWebRtcSignalFrame: () => {},
      },
    })

    const session = await caller.start()
    const connected = session.waitForConnected(1_000)
    const peer = peers[0]
    expect(peer).toBeDefined()
    if (!peer) throw new Error('peer connection was not created')
    peer.connectionState = 'connected'
    peer.onconnectionstatechange?.()

    await expect(connected).resolves.toBeUndefined()
  })

  test('acquires microphone audio inside the WebRTC interlock and adds tracks before creating offer', async () => {
    const order: string[] = []
    const sent: WebRtcSignalFrame[] = []
    const peers: FakePeerConnection[] = []
    const audioTrack = { kind: 'audio', stop: () => order.push('track.stop') }
    const stream = {
      getAudioTracks: () => [audioTrack],
      getTracks: () => [audioTrack],
    }
    const caller = createWebRtcCaller({
      audio: true,
      loadRuntime: async () => ({
        mediaDevices: {
          getUserMedia: async (constraints) => {
            order.push(`getUserMedia:${constraints.audio}:${constraints.video}`)
            return stream
          },
        },
        RTCPeerConnection: class extends FakePeerConnection {
          constructor(config: unknown) {
            super(config)
            peers.push(this)
          }

          async createOffer() {
            order.push('createOffer')
            return super.createOffer()
          }
        },
      }),
      nextCallId: () => 'call-audio',
      runAudioSession: async (session) => {
        order.push('interlock.enter')
        return {
          close: () => {
            order.push('interlock.exit')
          },
          result: await session(),
        }
      },
      transport: {
        call: async <T>(): Promise<T> =>
          ({ iceServers: [{ urls: 'turn:turn.example.test:443' }] }) as T,
        onWebRtcSignalFrame: () => () => {},
        sendWebRtcSignalFrame: (frame) => sent.push(frame),
      },
      workspaceId: 'workspace-1',
    })

    const session = await caller.start()

    expect(order).toEqual(['interlock.enter', 'getUserMedia:true:false', 'createOffer'])
    expect(peers[0]?.addedTracks).toEqual([{ stream, track: audioTrack }])
    expect(sent[0]).toMatchObject({
      call_id: 'call-audio',
      kind: 'offer',
      type: 'webrtc_signal',
      workspace_id: 'workspace-1',
    })

    session.close()
    expect(order).toEqual([
      'interlock.enter',
      'getUserMedia:true:false',
      'createOffer',
      'track.stop',
      'interlock.exit',
    ])
  })

  test('closes tracks, peer, signaling, and interlock when connection probe times out', async () => {
    const order: string[] = []
    const sent: WebRtcSignalFrame[] = []
    const peers: FakePeerConnection[] = []
    const audioTrack = { kind: 'audio', stop: () => order.push('track.stop') }
    const stream = {
      getAudioTracks: () => [audioTrack],
      getTracks: () => [audioTrack],
    }
    const caller = createWebRtcCaller({
      audio: true,
      loadRuntime: async () => ({
        mediaDevices: {
          getUserMedia: async () => stream,
        },
        RTCPeerConnection: class extends FakePeerConnection {
          constructor(config: unknown) {
            super(config)
            peers.push(this)
          }
        },
      }),
      nextCallId: () => 'call-timeout',
      runAudioSession: async (session) => ({
        close: () => {
          order.push('interlock.exit')
        },
        result: await session(),
      }),
      transport: {
        call: async <T>(): Promise<T> =>
          ({ iceServers: [{ urls: 'turn:turn.example.test:443' }] }) as T,
        onWebRtcSignalFrame: () => () => {
          order.push('unsubscribe')
        },
        sendWebRtcSignalFrame: (frame) => sent.push(frame),
      },
      workspaceId: 'workspace-1',
    })

    const result = await runWebRtcConnectionProbeSession(() => caller.start(), 1)

    expect(result).toEqual({
      callId: 'call-timeout',
      ok: false,
      reason: 'WebRTC connection timed out',
    })
    expect(peers[0]?.closed).toBe(true)
    expect(order).toEqual(['unsubscribe', 'track.stop', 'interlock.exit'])
    expect(sent.at(-1)).toMatchObject({
      call_id: 'call-timeout',
      kind: 'bye',
      type: 'webrtc_signal',
    })
  })

  test('closes tracks, peer, signaling, and interlock when a connected call later fails', async () => {
    const order: string[] = []
    const peers: FakePeerConnection[] = []
    const audioTrack = { kind: 'audio', stop: () => order.push('track.stop') }
    const stream = {
      getAudioTracks: () => [audioTrack],
      getTracks: () => [audioTrack],
    }
    const closedCalls: string[] = []
    const caller = createWebRtcCaller({
      audio: true,
      loadRuntime: async () => ({
        mediaDevices: {
          getUserMedia: async () => stream,
        },
        RTCPeerConnection: class extends FakePeerConnection {
          constructor(config: unknown) {
            super(config)
            peers.push(this)
          }
        },
      }),
      nextCallId: () => 'call-connected-failed',
      onConnectionClosed: (event) => closedCalls.push(`${event.callId}:${event.state}`),
      runAudioSession: async (session) => ({
        close: () => {
          order.push('interlock.exit')
        },
        result: await session(),
      }),
      transport: {
        call: async <T>(): Promise<T> =>
          ({ iceServers: [{ urls: 'turn:turn.example.test:443' }] }) as T,
        onWebRtcSignalFrame: () => () => {
          order.push('unsubscribe')
        },
        sendWebRtcSignalFrame: () => {},
      },
    })

    const session = await caller.start()
    const connected = session.waitForConnected()
    const peer = peers[0]
    expect(peer).toBeDefined()
    if (!peer) throw new Error('peer connection was not created')
    peer.connectionState = 'connected'
    peer.onconnectionstatechange?.()
    await connected

    peer.connectionState = 'failed'
    peer.onconnectionstatechange?.()

    expect(peer.closed).toBe(true)
    expect(order).toEqual(['unsubscribe', 'track.stop', 'interlock.exit'])
    expect(closedCalls).toEqual(['call-connected-failed:failed'])
  })

  test('cleans up microphone, peer, signaling, and interlock when setup fails after getUserMedia', async () => {
    const order: string[] = []
    const peers: FakePeerConnection[] = []
    const audioTrack = { kind: 'audio', stop: () => order.push('track.stop') }
    const stream = {
      getAudioTracks: () => [audioTrack],
      getTracks: () => [audioTrack],
    }
    const caller = createWebRtcCaller({
      audio: true,
      loadRuntime: async () => ({
        mediaDevices: {
          getUserMedia: async () => stream,
        },
        RTCPeerConnection: class extends FakePeerConnection {
          constructor(config: unknown) {
            super(config)
            peers.push(this)
          }

          async createOffer(): Promise<{ sdp: string; type: 'offer' }> {
            throw new Error('offer failed')
          }
        },
      }),
      nextCallId: () => 'call-setup-failed',
      runAudioSession: async (session) => ({
        close: () => {
          order.push('interlock.exit')
        },
        result: await session(),
      }),
      transport: {
        call: async <T>(): Promise<T> =>
          ({ iceServers: [{ urls: 'turn:turn.example.test:443' }] }) as T,
        onWebRtcSignalFrame: () => () => {
          order.push('unsubscribe')
        },
        sendWebRtcSignalFrame: () => {},
      },
    })

    await expect(caller.start()).rejects.toThrow('offer failed')

    expect(peers[0]?.closed).toBe(true)
    expect(order).toEqual(['unsubscribe', 'track.stop', 'interlock.exit'])
  })

  test('notifies with remote downlink audio stream and keeps the session open for test calls', async () => {
    const peers: FakePeerConnection[] = []
    const received: Array<{ streams?: unknown[]; track?: unknown }> = []
    const caller = createWebRtcCaller({
      loadRuntime: async () => ({
        RTCPeerConnection: class extends FakePeerConnection {
          constructor(config: unknown) {
            super(config)
            peers.push(this)
          }
        },
      }),
      nextCallId: () => 'call-downlink',
      onRemoteTrack: (event) => {
        received.push(event)
      },
      transport: {
        call: async <T>(): Promise<T> =>
          ({ iceServers: [{ urls: 'turn:turn.example.test:443' }] }) as T,
        onWebRtcSignalFrame: () => () => {},
        sendWebRtcSignalFrame: () => {},
      },
    })

    await caller.start()
    const remoteAudioTrack = { kind: 'audio' }
    const remoteStream = { id: 'remote-stream-1' }
    peers[0]?.ontrack?.({ streams: [remoteStream], track: remoteAudioTrack })

    expect(received).toEqual([{ streams: [remoteStream], track: remoteAudioTrack }])
    expect(peers[0]?.closed).toBe(false)
  })
})
