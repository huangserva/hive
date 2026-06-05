import { describe, expect, test } from 'vitest'
import type { WebRtcSignalFrame } from '../src/api/webrtc-signal-protocol.js'
import { createWebRtcCaller } from '../src/lib/webrtc-caller.js'

class FakePeerConnection {
  localDescription: unknown = null
  connectionState = 'new'
  onconnectionstatechange: (() => void) | null = null
  onicecandidate: ((event: { candidate: unknown | null }) => void) | null = null
  remoteDescription: unknown = null
  addedCandidates: unknown[] = []
  closed = false

  constructor(readonly config: unknown) {}

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
})
