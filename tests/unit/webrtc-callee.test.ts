import { afterEach, describe, expect, test, vi } from 'vitest'
import type { MobileChatMessageType } from '../../src/server/mobile-chat-store.js'
import { createVoiceCallStateFrame } from '../../src/server/voice-call-state-protocol.js'
import type { VoiceDownlinkSegmentFrame } from '../../src/server/voice-downlink-segment-protocol.js'
import {
  createWebRtcCallee,
  resolveWebRtcForceRelayEnabled,
} from '../../src/server/webrtc-callee.js'
import type { WebRtcSignalFrame } from '../../src/server/webrtc-signal-protocol.js'
import { createWebRtcUpstreamAudioSink } from '../../src/server/webrtc-upstream-audio.js'

class FakePeerConnection {
  addedTracks: unknown[] = []
  localDescription: { sdp: string; type: 'answer' } | null = null
  connectionState = 'new'
  iceConnectionState = 'new'
  onicecandidate: ((event: { candidate: unknown | null }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
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

class FakeAudioSink {
  ondata?: (data: unknown) => void
  constructor(readonly track: unknown) {}
  stop() {}
}

const createWebRtcStore = () => ({
  activeRun: {
    agentId: 'workspace-1:orchestrator',
    exitCode: null,
    output: '',
    pid: 123,
    runId: 'run-1',
    startedAt: 1,
    status: 'running' as const,
  },
  chat: [] as Array<{
    content_json: string
    created_at: number
    direction: 'inbound' | 'outbound'
    id: string
    message_type: MobileChatMessageType
    workspace_id: string
  }>,
  inputs: [] as unknown[],
  getActiveRunByAgentId(workspaceId: string, workerId: string) {
    expect(workspaceId).toBe('workspace-1')
    expect(workerId).toBe('workspace-1:orchestrator')
    return this.activeRun
  },
  insertMobileChatMessage(
    workspaceId: string,
    direction: 'inbound' | 'outbound',
    messageType: MobileChatMessageType,
    contentJson: string
  ) {
    const message = {
      content_json: contentJson,
      created_at: 1,
      direction,
      id: `message-${this.chat.length + 1}`,
      message_type: messageType,
      workspace_id: workspaceId,
    }
    this.chat.push(message)
    return message
  },
  listMobileChatMessages: () => [],
  listWorkers: () => [],
  recordUserInput(...input: unknown[]) {
    this.inputs.push(input)
  },
})

describe('WebRTC callee', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  test('answers an offer and emits trickle ICE without using JSON-RPC', async () => {
    vi.stubEnv('HIVE_WEBRTC_FORCE_RELAY', '0')
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

  test('reports active calls by relay device id and clears them when the call closes', async () => {
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

    expect(callee.hasActiveCall('device-1')).toBe(false)
    expect(callee.hasActiveWorkspaceCall('workspace-1')).toBe(false)
    expect(callee.getActiveWorkspaceCallIds('workspace-1')).toEqual([])
    await callee.handleSignal(
      {
        call_id: 'call-device',
        kind: 'offer',
        sdp: 'offer-sdp',
        sdp_type: 'offer',
        type: 'webrtc_signal',
        workspace_id: 'workspace-1',
      },
      { deviceId: 'device-1', send: () => {} }
    )

    expect(callee.hasActiveCall('device-1')).toBe(true)
    expect(callee.hasActiveCall('device-2')).toBe(false)
    expect(callee.hasActiveWorkspaceCall('workspace-1')).toBe(true)
    expect(callee.hasActiveWorkspaceCall('workspace-2')).toBe(false)
    expect(callee.getActiveWorkspaceCallIds('workspace-1')).toEqual(['call-device'])

    await callee.handleSignal(
      { call_id: 'call-device', kind: 'bye', type: 'webrtc_signal' },
      { deviceId: 'device-1', send: () => {} }
    )

    expect(peers[0]?.closed).toBe(true)
    expect(callee.hasActiveCall('device-1')).toBe(false)
    expect(callee.hasActiveWorkspaceCall('workspace-1')).toBe(false)
    expect(callee.getActiveWorkspaceCallIds('workspace-1')).toEqual([])
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
    const startedInputs: unknown[] = []
    const stderr: string[] = []
    const writeSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        stderr.push(String(chunk))
        return true
      })
    const callee = createWebRtcCallee({
      audioSink: {
        start: (input) => {
          startedInputs.push(input)
          const { callId } = input
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
    const audioStream = { id: 'stream-1' }
    peers[0]?.ontrack?.({
      receiver: { id: 'receiver-1' },
      streams: [audioStream],
      track: audioTrack,
    })
    await callee.handleSignal(
      { call_id: 'call-audio', kind: 'bye', type: 'webrtc_signal' },
      { send: () => {} }
    )

    writeSpy.mockRestore()
    expect(startedInputs).toEqual([
      {
        callId: 'call-audio',
        isDownlinkPlaybackActive: expect.any(Function),
        onSpeechStart: expect.any(Function),
        receiver: { id: 'receiver-1' },
        sendCallState: expect.any(Function),
        streams: [audioStream],
        track: audioTrack,
        workspaceId: 'workspace-1',
      },
    ])
    expect(stderr.join('')).toContain(
      'audio sink started: call_id=call-audio track_kind=audio receiver=yes streams=1'
    )
    expect(closedSessions).toEqual(['call-audio'])
    expect(peers[0]?.closed).toBe(true)
  })

  test('normalizes upstream call state frames to the active call id and logs the send', async () => {
    const peers: FakePeerConnection[] = []
    const dataFrames: unknown[] = []
    const stderr: string[] = []
    const writeSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        stderr.push(String(chunk))
        return true
      })
    const callee = createWebRtcCallee({
      audioSink: {
        start: (input) => {
          input.sendCallState?.(
            createVoiceCallStateFrame({
              callId: 'stale-call-id',
              phase: 'processing',
              turnId: 'call-state-link-turn-1',
            })
          )
          return { close: () => {} }
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
        call_id: 'call-state-link',
        kind: 'offer',
        sdp: 'offer-sdp',
        sdp_type: 'offer',
        type: 'webrtc_signal',
        workspace_id: 'workspace-1',
      },
      { send: () => {}, sendData: (frame) => dataFrames.push(frame) }
    )
    peers[0]?.ontrack?.({
      receiver: { id: 'receiver-1' },
      streams: [],
      track: { kind: 'audio' },
    })

    writeSpy.mockRestore()
    expect(dataFrames).toEqual([
      expect.objectContaining({
        call_id: 'call-state-link',
        phase: 'processing',
        turn_id: 'call-state-link-turn-1',
        type: 'voice_call_state',
      }),
    ])
    expect(stderr.join('')).toContain(
      'voice call state sent: call_id=call-state-link turn_id=call-state-link-turn-1 phase=processing'
    )
  })

  test('sends heard and processing call state frames through the callee upstream path', async () => {
    vi.stubEnv('HIVE_VOICE_INTENT_FRONT', '1')
    vi.stubEnv('HIVE_GLM_GATEKEEPER', '0')
    const peers: FakePeerConnection[] = []
    const dataFrames: unknown[] = []
    const stderr: string[] = []
    const writeSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        stderr.push(String(chunk))
        return true
      })
    let streamingOptions:
      | Parameters<
          NonNullable<
            Parameters<typeof createWebRtcUpstreamAudioSink>[0]['createStreamingRecognitionSession']
          >
        >[1]
      | undefined
    const audioSink = createWebRtcUpstreamAudioSink({
      createStreamingRecognitionSession: async (_callId, options) => {
        streamingOptions = options
        return {
          close: () => {},
          flush: async () => {},
          pushFrame: () => {},
        }
      },
      createVoiceIntentSession: () => ({
        close: vi.fn(),
        evaluate: vi.fn().mockResolvedValue({
          status: 'accepted',
          verdict: {
            action: 'drop',
            completeness: 'incomplete',
            confidence: 0.6,
            distilled_intent: '',
            intent_generation: 1,
            reason: 'test',
            reply_text: '',
            should_speculate_tts: false,
          },
        }),
      }),
      loadAudioSink: async () => FakeAudioSink,
      logger: { info: () => {}, warn: () => {} },
      store: createWebRtcStore(),
    })
    const callee = createWebRtcCallee({
      audioSink,
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
        call_id: 'call-upstream-state',
        kind: 'offer',
        sdp: 'offer-sdp',
        sdp_type: 'offer',
        type: 'webrtc_signal',
        workspace_id: 'workspace-1',
      },
      { send: () => {}, sendData: (frame) => dataFrames.push(frame) }
    )
    peers[0]?.ontrack?.({
      receiver: { id: 'receiver-1' },
      streams: [],
      track: { kind: 'audio' },
    })
    await vi.waitFor(() => expect(streamingOptions).toBeDefined())
    const callbacks = streamingOptions
    if (!callbacks) throw new Error('streaming callbacks were not captured')

    await callbacks.onPartial?.('你好')
    await callbacks.onFinal('你好')

    writeSpy.mockRestore()
    expect(dataFrames).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          call_id: 'call-upstream-state',
          phase: 'heard',
          turn_id: 'call-upstream-state-turn-1',
          type: 'voice_call_state',
        }),
        expect.objectContaining({
          call_id: 'call-upstream-state',
          phase: 'processing',
          turn_id: 'call-upstream-state-turn-1',
          type: 'voice_call_state',
        }),
      ])
    )
    expect(stderr.join('')).toContain(
      'voice call state sent: call_id=call-upstream-state turn_id=call-upstream-state-turn-1 phase=heard'
    )
    expect(stderr.join('')).toContain(
      'voice call state sent: call_id=call-upstream-state turn_id=call-upstream-state-turn-1 phase=processing'
    )
  })

  test('wires upstream speech-start to interrupt the downlink session', async () => {
    const peers: FakePeerConnection[] = []
    const interrupts: string[] = []
    let onSpeechStart: (() => void) | undefined
    const localTrack = { kind: 'audio' }
    const callee = createWebRtcCallee({
      audioSink: {
        start: (input) => {
          onSpeechStart = input.onSpeechStart
          return { close: () => {} }
        },
      },
      downlinkAudio: {
        startCall: async () => ({
          close: () => {},
          interrupt: () => {
            interrupts.push('interrupt')
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
        call_id: 'call-barge',
        kind: 'offer',
        sdp: 'offer-sdp',
        sdp_type: 'offer',
        type: 'webrtc_signal',
        workspace_id: 'workspace-1',
      },
      { send: () => {} }
    )
    peers[0]?.ontrack?.({
      receiver: { id: 'receiver-1' },
      streams: [],
      track: { kind: 'audio' },
    })

    onSpeechStart?.()

    expect(interrupts).toEqual(['interrupt'])
  })

  test('suppresses echo-level speech-start while file downlink is sending but keeps loud barge-in', async () => {
    const peers: FakePeerConnection[] = []
    const interrupts: string[] = []
    let onSpeechStart:
      | ((event: { consecutiveSpeechFrames: number; rms: number; threshold: number }) => void)
      | undefined
    const callee = createWebRtcCallee({
      audioSink: {
        start: (input) => {
          onSpeechStart = input.onSpeechStart as typeof onSpeechStart
          return { close: () => {} }
        },
      },
      fileDownlinkAudio: {
        startCall: () => ({
          close: () => {},
          getPlaybackState: () => ({
            generation: 1,
            state: 'sending',
            updatedAtMs: Date.now(),
          }),
          interrupt: () => {
            interrupts.push('interrupt')
          },
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
        call_id: 'call-echo-suppressed',
        kind: 'offer',
        sdp: 'offer-sdp',
        sdp_type: 'offer',
        type: 'webrtc_signal',
        workspace_id: 'workspace-1',
      },
      { send: () => {} }
    )
    peers[0]?.ontrack?.({
      receiver: { id: 'receiver-1' },
      streams: [],
      track: { kind: 'audio' },
    })

    onSpeechStart?.({ consecutiveSpeechFrames: 3, rms: 0.04, threshold: 0.03 })
    expect(interrupts).toEqual([])

    onSpeechStart?.({ consecutiveSpeechFrames: 3, rms: 0.07, threshold: 0.03 })
    expect(interrupts).toEqual(['interrupt'])
  })

  test('logs speech-start RMS together with file downlink state before interrupting', async () => {
    const stderr: string[] = []
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk))
      return true
    })
    const peers: FakePeerConnection[] = []
    let onSpeechStart: ((event: { rms: number; threshold: number }) => void) | undefined
    const callee = createWebRtcCallee({
      audioSink: {
        start: (input) => {
          onSpeechStart = input.onSpeechStart as typeof onSpeechStart
          return { close: () => {} }
        },
      },
      fileDownlinkAudio: {
        startCall: () => ({
          close: () => {},
          getPlaybackState: () => ({
            generation: 7,
            messageId: 'message-playing',
            state: 'sent',
            turnId: 'turn-playing',
          }),
          interrupt: () => {},
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

    try {
      await callee.handleSignal(
        {
          call_id: 'call-echo',
          kind: 'offer',
          sdp: 'offer-sdp',
          sdp_type: 'offer',
          type: 'webrtc_signal',
          workspace_id: 'workspace-1',
        },
        { send: () => {} }
      )
      peers[0]?.ontrack?.({
        receiver: { id: 'receiver-1' },
        streams: [],
        track: { kind: 'audio' },
      })

      onSpeechStart?.({ rms: 0.08123, threshold: 0.03 })

      const logs = stderr.join('')
      expect(logs).toContain('upstream speech-start interrupt: call_id=call-echo')
      expect(logs).toContain('rms=0.08123')
      expect(logs).toContain('threshold=0.03000')
      expect(logs).toContain('"messageId":"message-playing"')
      expect(logs).toContain('"state":"sent"')
    } finally {
      writeSpy.mockRestore()
    }
  })

  test('closes and sends bye when audio sink start throws synchronously', async () => {
    const sent: WebRtcSignalFrame[] = []
    const peers: FakePeerConnection[] = []
    const callee = createWebRtcCallee({
      audioSink: {
        start: () => {
          throw new Error('audio sink unavailable')
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
        call_id: 'call-audio-start-throws',
        kind: 'offer',
        sdp: 'offer-sdp',
        sdp_type: 'offer',
        type: 'webrtc_signal',
        workspace_id: 'workspace-1',
      },
      { send: (frame) => sent.push(frame) }
    )

    expect(() =>
      peers[0]?.ontrack?.({
        receiver: { id: 'receiver-1' },
        streams: [],
        track: { kind: 'audio' },
      })
    ).not.toThrow()
    expect(peers[0]?.closed).toBe(true)
    expect(sent).toContainEqual({
      call_id: 'call-audio-start-throws',
      kind: 'bye',
      type: 'webrtc_signal',
    })

    await callee.handleSignal(
      {
        call_id: 'call-audio-start-throws',
        candidate: { candidate: 'candidate:after-audio-fail' },
        kind: 'ice',
        type: 'webrtc_signal',
      },
      { send: (frame) => sent.push(frame) }
    )
    expect(peers[0]?.addedCandidates).toEqual([])
  })

  test('closes and sends bye when async audio sink start rejects', async () => {
    const sent: WebRtcSignalFrame[] = []
    const peers: FakePeerConnection[] = []
    const callee = createWebRtcCallee({
      audioSink: {
        start: async () => {
          throw new Error('audio sink rejected')
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
        call_id: 'call-audio-start-rejects',
        kind: 'offer',
        sdp: 'offer-sdp',
        sdp_type: 'offer',
        type: 'webrtc_signal',
        workspace_id: 'workspace-1',
      },
      { send: (frame) => sent.push(frame) }
    )
    peers[0]?.ontrack?.({
      receiver: { id: 'receiver-1' },
      streams: [],
      track: { kind: 'audio' },
    })

    await vi.waitFor(() => {
      expect(peers[0]?.closed).toBe(true)
      expect(sent).toContainEqual({
        call_id: 'call-audio-start-rejects',
        kind: 'bye',
        type: 'webrtc_signal',
      })
    })

    await callee.handleSignal(
      {
        call_id: 'call-audio-start-rejects',
        candidate: { candidate: 'candidate:after-audio-reject' },
        kind: 'ice',
        type: 'webrtc_signal',
      },
      { send: (frame) => sent.push(frame) }
    )
    expect(peers[0]?.addedCandidates).toEqual([])
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
        startCall: async () => {
          return {
            close: () => {
              localTrack.stop()
            },
            track: localTrack,
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
    expect(peers[0]?.closed).toBe(true)
  })

  test('starts file downlink without adding a WebRTC track and sends segment frames via data channel', async () => {
    const peers: FakePeerConnection[] = []
    const sent: WebRtcSignalFrame[] = []
    const sentData: VoiceDownlinkSegmentFrame[] = []
    const closedFileSessions: string[] = []
    const callee = createWebRtcCallee({
      fileDownlinkAudio: {
        startCall: async ({ callId, send }) => {
          send({
            call_id: callId,
            generation: 0,
            op: 'segment_open',
            segment_id: 1,
            seq: 0,
            turn_id: 'turn-1',
            type: 'voice_downlink_segment',
          })
          return {
            close: () => {
              closedFileSessions.push('closed')
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
        call_id: 'call-file-downlink',
        kind: 'offer',
        sdp: 'offer-sdp',
        sdp_type: 'offer',
        type: 'webrtc_signal',
        workspace_id: 'workspace-1',
      },
      {
        send: (frame) => sent.push(frame),
        sendData: (frame) => sentData.push(frame as VoiceDownlinkSegmentFrame),
      }
    )

    expect(peers[0]?.addedTracks).toEqual([])
    expect(sent).toEqual([
      expect.objectContaining({
        call_id: 'call-file-downlink',
        kind: 'answer',
        type: 'webrtc_signal',
      }),
    ])
    expect(sentData).toEqual([
      expect.objectContaining({
        call_id: 'call-file-downlink',
        op: 'segment_open',
        type: 'voice_downlink_segment',
      }),
    ])

    await callee.handleSignal(
      { call_id: 'call-file-downlink', kind: 'bye', type: 'webrtc_signal' },
      { send: () => {}, sendData: () => {} }
    )
    expect(closedFileSessions).toEqual(['closed'])
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

  test('clears the unanswered-call timer when ice connection reaches completed', async () => {
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
        call_id: 'call-ice-completed',
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
    peer.connectionState = 'new'
    peer.iceConnectionState = 'completed'
    peer.oniceconnectionstatechange?.()

    await vi.advanceTimersByTimeAsync(30_000)
    expect(peer.closed).toBe(false)
  })
})
