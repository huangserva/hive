/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, waitFor } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// @ts-expect-error This test must share the root React instance used by @testing-library/react.
vi.mock('react', async () => await import('../../../node_modules/react/index.js'))

const audioMock = vi.hoisted(() => ({
  player: {
    pause: vi.fn(),
    play: vi.fn(),
    remove: vi.fn(),
    replace: vi.fn(),
  },
  setAudioModeAsync: vi.fn().mockResolvedValue(undefined),
}))

const reassemblerMock = vi.hoisted(() => ({
  cache: {
    accept: vi.fn(),
    clear: vi.fn(),
    cleanup: vi.fn(),
    size: vi.fn(() => 0),
  },
  create: vi.fn(),
}))

const relayMock = vi.hoisted(() => ({
  closeRegistry: vi.fn(),
  diagnosticsUnsubscribe: vi.fn(),
  eventUnsubscribe: vi.fn(),
  callStateListener: null as
    | null
    | ((frame: { call_id: string; phase: string; type: string } & Record<string, unknown>) => void),
  callStateUnsubscribe: vi.fn(),
  segmentListener: null as
    | null
    | ((frame: { call_id: string; op: string; type: string } & Record<string, unknown>) => void),
  segmentUnsubscribe: vi.fn(),
  statusUnsubscribe: vi.fn(),
  transport: {
    call: vi.fn(),
    close: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    measureVoiceStreamLatency: vi.fn(),
    onDiagnosticsEvent: vi.fn(),
    onEvent: vi.fn(),
    onStatusChange: vi.fn(),
    onVoiceCallStateFrame: vi.fn(),
    onVoiceDownlinkSegmentFrame: vi.fn(),
    onVoiceStreamFrame: vi.fn(),
    onWebRtcSignalFrame: vi.fn(),
    requestVoiceStreamSynthesis: vi.fn(),
    sendVoiceStreamFrame: vi.fn(),
    sendWebRtcSignalFrame: vi.fn(),
    status: vi.fn(() => 'ready'),
  },
}))

const webRtcMock = vi.hoisted(() => ({
  audioRoute: {
    stop: vi.fn().mockResolvedValue(undefined),
  },
  createWebRtcCaller: vi.fn(),
  session: {
    callId: 'call-1',
    close: vi.fn(),
    peerConnection: {},
    waitForConnected: vi.fn().mockResolvedValue(undefined),
  },
  startAudioRoute: vi.fn(),
}))

vi.mock('expo-audio', () => ({
  setAudioModeAsync: audioMock.setAudioModeAsync,
  useAudioPlayer: () => audioMock.player,
}))

vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { webRtcDownlinkMode: 'file_segments' } } },
}))

vi.mock('expo-secure-store', () => ({
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
  getItemAsync: vi.fn(async (key: string) =>
    key === 'hippoteam.mobileWorkspaceId' ? 'workspace-1' : null
  ),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
    currentState: 'active',
  },
}))

vi.mock('../src/api/relay-transport-registry.js', () => ({
  createRelayTransportRegistry: () => ({
    close: relayMock.closeRegistry,
    get: vi.fn(() => relayMock.transport),
  }),
}))

vi.mock('../src/api/voice-downlink-segment-protocol.js', () => ({
  createVoiceDownlinkSegmentReassemblerCache: reassemblerMock.create,
}))

vi.mock('../src/lib/webrtc-caller.js', () => ({
  createWebRtcCaller: webRtcMock.createWebRtcCaller,
  resolveWebRtcForceRelayEnabled: () => false,
}))

vi.mock('../src/lib/webrtc-incall-manager.js', () => ({
  resolveWebRtcAudioRoute: () => 'communication',
  startWebRtcInCallAudioRoute: webRtcMock.startAudioRoute,
}))

vi.mock('../src/notifications.js', () => ({
  getExpoPushToken: vi.fn().mockResolvedValue(null),
}))

import { MobileRuntimeProvider, useMobileRuntime } from '../src/api/mobile-runtime-context.js'

type Runtime = ReturnType<typeof useMobileRuntime>

const Probe = ({ onRuntime }: { onRuntime: (runtime: Runtime) => void }) => {
  const runtime = useMobileRuntime()
  onRuntime(runtime)
  return null
}

const requireRuntime = (runtime: Runtime | null): Runtime => {
  if (!runtime) throw new Error('mobile runtime was not mounted')
  return runtime
}

describe('MobileRuntime WebRTC file downlink disconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reassemblerMock.create.mockReturnValue(reassemblerMock.cache)
    relayMock.transport.onDiagnosticsEvent.mockReturnValue(relayMock.diagnosticsUnsubscribe)
    relayMock.transport.onEvent.mockReturnValue(relayMock.eventUnsubscribe)
    relayMock.transport.onStatusChange.mockReturnValue(relayMock.statusUnsubscribe)
    relayMock.transport.onVoiceCallStateFrame.mockImplementation((listener) => {
      relayMock.callStateListener = listener
      return relayMock.callStateUnsubscribe
    })
    relayMock.segmentListener = null
    relayMock.transport.onVoiceDownlinkSegmentFrame.mockImplementation((listener) => {
      relayMock.segmentListener = listener
      return relayMock.segmentUnsubscribe
    })
    webRtcMock.startAudioRoute.mockResolvedValue(webRtcMock.audioRoute)
    webRtcMock.createWebRtcCaller.mockImplementation((options) => ({
      start: vi.fn(async () => {
        const runAudioSession = options.runAudioSession as
          | ((
              runSession: () => Promise<typeof webRtcMock.session>
            ) => Promise<{ result: typeof webRtcMock.session }>)
          | undefined
        if (!runAudioSession) return webRtcMock.session
        const wrapped = await runAudioSession(async () => webRtcMock.session)
        return wrapped.result
      }),
    }))
  })

  afterEach(() => {
    cleanup()
  })

  test('disconnect closes active WebRTC call and clears file_segments playback resources', async () => {
    let runtime: Runtime | null = null
    render(
      React.createElement(
        MobileRuntimeProvider,
        null,
        React.createElement(Probe, { onRuntime: (next) => (runtime = next) })
      )
    )

    await waitFor(() => expect(runtime?.selectedWorkspaceId).toBe('workspace-1'))

    let startResult: Awaited<ReturnType<Runtime['startWebRtcTestCall']>> | null = null
    await act(async () => {
      startResult = await requireRuntime(runtime).startWebRtcTestCall()
    })

    expect(startResult).toEqual({ callId: 'call-1', ok: true })
    expect(relayMock.transport.onVoiceDownlinkSegmentFrame).toHaveBeenCalledTimes(1)
    expect(relayMock.segmentUnsubscribe).not.toHaveBeenCalled()
    expect(reassemblerMock.cache.clear).toHaveBeenCalledTimes(1)

    reassemblerMock.cache.clear.mockClear()
    audioMock.player.pause.mockClear()
    await act(async () => {
      await runtime?.disconnect()
    })

    expect(webRtcMock.session.close).toHaveBeenCalledTimes(1)
    expect(webRtcMock.audioRoute.stop).toHaveBeenCalledTimes(1)
    expect(relayMock.segmentUnsubscribe).toHaveBeenCalledTimes(1)
    expect(reassemblerMock.cache.clear).toHaveBeenCalledTimes(1)
    expect(audioMock.player.pause).toHaveBeenCalledTimes(1)
  })

  test('file_segments interrupt frame pauses current playback, clears stale chunks, and allows next generation playback', async () => {
    let runtime: Runtime | null = null
    render(
      React.createElement(
        MobileRuntimeProvider,
        null,
        React.createElement(Probe, { onRuntime: (next) => (runtime = next) })
      )
    )

    await waitFor(() => expect(runtime?.selectedWorkspaceId).toBe('workspace-1'))
    await act(async () => {
      await runtime?.startWebRtcTestCall()
    })

    reassemblerMock.cache.accept.mockReturnValueOnce({
      audio: 'first-audio',
      call_id: 'call-1',
      format: 'mp3',
      generation: 0,
      is_final: true,
      mime: 'audio/mpeg',
      segment_id: 1,
      turn_id: 'turn-1',
    })
    await act(async () => {
      relayMock.segmentListener?.({
        call_id: 'call-1',
        op: 'segment_chunk',
        type: 'voice_downlink_segment',
      })
    })
    expect(audioMock.player.replace).toHaveBeenLastCalledWith({
      uri: 'data:audio/mpeg;base64,first-audio',
    })
    expect(audioMock.player.play).toHaveBeenCalledTimes(1)

    reassemblerMock.cache.clear.mockClear()
    audioMock.player.pause.mockClear()
    await act(async () => {
      relayMock.segmentListener?.({
        call_id: 'call-1',
        generation: 1,
        op: 'interrupt',
        segment_id: 0,
        seq: 0,
        turn_id: 'interrupt-1',
        type: 'voice_downlink_segment',
      })
    })

    expect(audioMock.player.pause).toHaveBeenCalledTimes(1)
    expect(reassemblerMock.cache.clear).toHaveBeenCalledTimes(1)

    reassemblerMock.cache.accept.mockReturnValueOnce({
      audio: 'second-audio',
      call_id: 'call-1',
      format: 'mp3',
      generation: 1,
      is_final: true,
      mime: 'audio/mpeg',
      segment_id: 1,
      turn_id: 'turn-2',
    })
    await act(async () => {
      relayMock.segmentListener?.({
        call_id: 'call-1',
        op: 'segment_chunk',
        type: 'voice_downlink_segment',
      })
    })

    expect(audioMock.player.replace).toHaveBeenLastCalledWith({
      uri: 'data:audio/mpeg;base64,second-audio',
    })
    expect(audioMock.player.play).toHaveBeenCalledTimes(2)
  })

  test('voice_call_state frames update the runtime call phase for the active call only', async () => {
    let runtime: Runtime | null = null
    render(
      React.createElement(
        MobileRuntimeProvider,
        null,
        React.createElement(Probe, { onRuntime: (next) => (runtime = next) })
      )
    )

    await waitFor(() => expect(runtime?.selectedWorkspaceId).toBe('workspace-1'))
    await act(async () => {
      await requireRuntime(runtime).startWebRtcTestCall()
    })

    expect(requireRuntime(runtime).webRtcCallPhase).toBe('listening')
    expect(relayMock.transport.onVoiceCallStateFrame).toHaveBeenCalledTimes(1)

    await act(async () => {
      relayMock.callStateListener?.({
        call_id: 'other-call',
        phase: 'processing',
        ts: 1,
        turn_id: 'turn-1',
        type: 'voice_call_state',
      })
    })
    expect(requireRuntime(runtime).webRtcCallPhase).toBe('listening')

    await act(async () => {
      relayMock.callStateListener?.({
        call_id: 'call-1',
        phase: 'processing',
        ts: 2,
        turn_id: 'turn-1',
        type: 'voice_call_state',
      })
    })
    expect(requireRuntime(runtime).webRtcCallPhase).toBe('processing')

    await act(async () => {
      requireRuntime(runtime).stopWebRtcTestCall()
    })
    expect(requireRuntime(runtime).webRtcCallPhase).toBe('listening')
    expect(relayMock.callStateUnsubscribe).toHaveBeenCalledTimes(1)
  })
})
