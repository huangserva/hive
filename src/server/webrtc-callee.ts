import type { VoiceDownlinkSegmentFrame } from './voice-downlink-segment-protocol.js'
import type { WebRtcIceCandidateInit, WebRtcSignalFrame } from './webrtc-signal-protocol.js'

export interface WebRtcIceServer {
  credential?: string
  urls: string | string[]
  username?: string
}

type WebRtcPeerConnectionConfig = {
  iceServers: WebRtcIceServer[]
  iceTransportPolicy?: 'relay'
}

type WebRtcPeerConnection = {
  addIceCandidate(candidate: WebRtcIceCandidateInit): Promise<void> | void
  addTrack?: (track: WebRtcLocalAudioTrack) => unknown
  close(): void
  connectionState?: string
  createAnswer(): Promise<{ sdp: string; type: 'answer' }>
  onconnectionstatechange?: (() => void) | null
  onicecandidate: ((event: { candidate: unknown | null }) => void) | null
  oniceconnectionstatechange?: (() => void) | null
  ontrack?: ((event: WebRtcTrackEvent) => void) | null
  iceConnectionState?: string
  setLocalDescription(description: { sdp: string; type: 'answer' }): Promise<void> | void
  setRemoteDescription(description: { sdp: string; type: 'offer' }): Promise<void> | void
}

export interface WebRtcTrackEvent {
  receiver?: unknown
  streams?: unknown[]
  track?: {
    kind?: string
    [key: string]: unknown
  }
}

export interface WebRtcRuntime {
  RTCPeerConnection: new (config: WebRtcPeerConnectionConfig) => WebRtcPeerConnection
}

export interface WebRtcCalleeContext {
  deviceId?: string
  send(frame: WebRtcSignalFrame): void
  sendData?: (frame: VoiceDownlinkSegmentFrame) => void
}

export interface WebRtcLocalAudioTrack {
  kind?: string
  stop?: () => void
}

export interface WebRtcDownlinkAudioSession {
  close(): Promise<void> | void
  interrupt?: () => void
  track: WebRtcLocalAudioTrack
}

export interface WebRtcDownlinkAudio {
  startCall(input: {
    callId: string
    workspaceId: string
  }):
    | Promise<WebRtcDownlinkAudioSession | null | undefined>
    | WebRtcDownlinkAudioSession
    | null
    | undefined
}

export interface WebRtcFileDownlinkAudioSession {
  close(): Promise<void> | void
  interrupt?: () => void
}

export interface WebRtcFileDownlinkAudio {
  startCall(input: {
    callId: string
    send: (frame: VoiceDownlinkSegmentFrame) => void
    workspaceId: string
  }):
    | Promise<WebRtcFileDownlinkAudioSession | null | undefined>
    | WebRtcFileDownlinkAudioSession
    | null
    | undefined
}

export interface WebRtcRemoteAudioSession {
  close(): Promise<void> | void
}

export interface WebRtcRemoteAudioSink {
  start(input: {
    callId: string
    receiver?: unknown
    onSpeechStart?: () => void
    streams?: unknown[] | undefined
    track: NonNullable<WebRtcTrackEvent['track']>
    workspaceId: string
  }):
    | Promise<WebRtcRemoteAudioSession | null | undefined>
    | WebRtcRemoteAudioSession
    | null
    | undefined
}

export interface WebRtcCalleeOptions {
  audioSink?: WebRtcRemoteAudioSink
  callTimeoutMs?: number
  downlinkAudio?: WebRtcDownlinkAudio
  fileDownlinkAudio?: WebRtcFileDownlinkAudio
  getIceServers: () => Promise<WebRtcIceServer[]> | WebRtcIceServer[]
  loadRuntime?: () => Promise<WebRtcRuntime>
}

type WebRtcCall = {
  audioSessions: Set<WebRtcRemoteAudioSession>
  closed: boolean
  deviceId: string | null
  downlinkSession: WebRtcDownlinkAudioSession | null
  fileDownlinkSession: WebRtcFileDownlinkAudioSession | null
  peer: WebRtcPeerConnection
  timer: ReturnType<typeof setTimeout> | null
  workspaceId: string | null
}

const DEFAULT_WEBRTC_CALL_TIMEOUT_MS = 45_000

const parseEnabledFlag = (value: unknown) => {
  if (value === true) return true
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true'
}

export const resolveWebRtcForceRelayEnabled = (env: Record<string, unknown> = process.env) =>
  parseEnabledFlag(env.HIVE_WEBRTC_FORCE_RELAY)

const createPeerConnectionConfig = (iceServers: WebRtcIceServer[]): WebRtcPeerConnectionConfig =>
  resolveWebRtcForceRelayEnabled() ? { iceServers, iceTransportPolicy: 'relay' } : { iceServers }

const log = (message: string, error?: unknown) => {
  const ts = new Date().toISOString()
  const suffix = error ? ` error=${error instanceof Error ? error.message : String(error)}` : ''
  process.stderr.write(`[webrtc-callee ${ts}] ${message}${suffix}\n`)
}

const normalizeIceCandidate = (candidate: unknown): WebRtcIceCandidateInit | null => {
  if (!candidate) return null
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    'toJSON' in candidate &&
    typeof (candidate as { toJSON?: unknown }).toJSON === 'function'
  ) {
    return (candidate as { toJSON: () => WebRtcIceCandidateInit }).toJSON()
  }
  return candidate as WebRtcIceCandidateInit
}

const loadWrtcRuntime = async (): Promise<WebRtcRuntime> => {
  const moduleName = '@roamhq/wrtc'
  const runtime = (await import(moduleName)) as {
    RTCPeerConnection?: WebRtcRuntime['RTCPeerConnection']
    default?: {
      RTCPeerConnection?: WebRtcRuntime['RTCPeerConnection']
    }
  }
  const RTCPeerConnection = runtime.RTCPeerConnection ?? runtime.default?.RTCPeerConnection
  if (!RTCPeerConnection) {
    throw new Error('@roamhq/wrtc RTCPeerConnection is unavailable')
  }
  return { RTCPeerConnection }
}

export const createWebRtcCallee = (options: WebRtcCalleeOptions) => {
  const loadRuntime = options.loadRuntime ?? loadWrtcRuntime
  const callTimeoutMs = options.callTimeoutMs ?? DEFAULT_WEBRTC_CALL_TIMEOUT_MS
  const calls = new Map<string, WebRtcCall>()

  const clearCallTimer = (call: WebRtcCall) => {
    if (!call.timer) return
    clearTimeout(call.timer)
    call.timer = null
  }

  const closeCall = (callId: string) => {
    const call = calls.get(callId)
    if (!call) return
    call.closed = true
    clearCallTimer(call)
    for (const audioSession of call.audioSessions) {
      void Promise.resolve(audioSession.close()).catch(() => {})
    }
    call.audioSessions.clear()
    if (call.downlinkSession) {
      void Promise.resolve(call.downlinkSession.close()).catch(() => {})
      call.downlinkSession = null
    }
    if (call.fileDownlinkSession) {
      void Promise.resolve(call.fileDownlinkSession.close()).catch(() => {})
      call.fileDownlinkSession = null
    }
    call.peer.close()
    calls.delete(callId)
  }

  const closeCallWithBye = (callId: string, context: WebRtcCalleeContext) => {
    const call = calls.get(callId)
    if (!call || call.closed) return
    closeCall(callId)
    context.send({
      call_id: callId,
      kind: 'bye',
      type: 'webrtc_signal',
    })
  }

  const rememberCall = (
    callId: string,
    peer: WebRtcPeerConnection,
    deviceId: string | null,
    workspaceId: string | null
  ) => {
    const call: WebRtcCall = {
      audioSessions: new Set(),
      closed: false,
      deviceId,
      downlinkSession: null,
      fileDownlinkSession: null,
      peer,
      timer: setTimeout(() => closeCall(callId), callTimeoutMs),
      workspaceId,
    }
    calls.set(callId, call)
    return call
  }

  const hasActiveCall = (deviceId: string) => {
    for (const call of calls.values()) {
      if (!call.closed && call.deviceId === deviceId) return true
    }
    return false
  }

  const hasActiveWorkspaceCall = (workspaceId: string) => {
    for (const call of calls.values()) {
      if (!call.closed && call.workspaceId === workspaceId) return true
    }
    return false
  }

  const getActiveWorkspaceCallIds = (workspaceId: string) => {
    const activeCallIds: string[] = []
    for (const [callId, call] of calls) {
      if (!call.closed && call.workspaceId === workspaceId) activeCallIds.push(callId)
    }
    return activeCallIds
  }

  const handleSignal = async (
    frame: WebRtcSignalFrame,
    context: WebRtcCalleeContext
  ): Promise<boolean> => {
    if (frame.kind === 'offer') {
      log(
        `offer received: call_id=${frame.call_id} workspace=${frame.workspace_id} sdp_len=${frame.sdp?.length ?? 0}`
      )
      closeCall(frame.call_id)
      const [runtime, iceServers] = await Promise.all([loadRuntime(), options.getIceServers()])
      log(
        `ICE servers resolved: count=${iceServers.length} urls=${iceServers.map((s) => (typeof s.urls === 'string' ? s.urls : (s.urls as string[]).join(','))).join(' | ')}`
      )
      const peer = new runtime.RTCPeerConnection(createPeerConnectionConfig(iceServers))
      const call = rememberCall(
        frame.call_id,
        peer,
        context.deviceId ?? null,
        frame.workspace_id ?? null
      )
      if (options.downlinkAudio && frame.workspace_id && peer.addTrack) {
        try {
          const downlinkSession = await options.downlinkAudio.startCall({
            callId: frame.call_id,
            workspaceId: frame.workspace_id,
          })
          if (downlinkSession) {
            call.downlinkSession = downlinkSession
            peer.addTrack(downlinkSession.track)
            log(`downlink audio track added: call_id=${frame.call_id}`)
          }
        } catch (downlinkError) {
          log(`downlink audio failed: call_id=${frame.call_id}`, downlinkError)
          closeCall(frame.call_id)
          context.send({
            call_id: frame.call_id,
            kind: 'bye',
            type: 'webrtc_signal',
          })
          return true
        }
      }
      if (options.fileDownlinkAudio && frame.workspace_id) {
        try {
          const fileDownlinkSession = await options.fileDownlinkAudio.startCall({
            callId: frame.call_id,
            send: (downlinkFrame) => context.sendData?.(downlinkFrame),
            workspaceId: frame.workspace_id,
          })
          if (fileDownlinkSession) {
            call.fileDownlinkSession = fileDownlinkSession
            log(`file downlink session started: call_id=${frame.call_id}`)
          }
        } catch (downlinkError) {
          log(`file downlink failed: call_id=${frame.call_id}`, downlinkError)
          closeCall(frame.call_id)
          context.send({
            call_id: frame.call_id,
            kind: 'bye',
            type: 'webrtc_signal',
          })
          return true
        }
      }
      peer.onicecandidate = (event) => {
        const candidate = normalizeIceCandidate(event.candidate)
        if (candidate?.candidate) {
          log(
            `ICE candidate gathered: call_id=${frame.call_id} candidate=${candidate.candidate.substring(0, 80)}...`
          )
        } else {
          log(`ICE gathering complete (null candidate): call_id=${frame.call_id}`)
        }
        context.send({
          call_id: frame.call_id,
          candidate,
          kind: 'ice',
          type: 'webrtc_signal',
        })
      }
      const handleConnectionStateChange = () => {
        const states = [peer.connectionState, peer.iceConnectionState].filter(
          (state): state is string => typeof state === 'string'
        )
        log(
          `connection state changed: call_id=${frame.call_id} state=${peer.connectionState ?? 'unknown'} ice=${peer.iceConnectionState ?? 'unknown'}`
        )
        if (states.some((state) => state === 'connected' || state === 'completed')) {
          clearCallTimer(call)
          return
        }
        const state = states.find((candidate) => candidate === 'failed' || candidate === 'closed')
        if (state === 'failed' || state === 'closed') {
          log(`call closing: call_id=${frame.call_id} state=${state}`)
          closeCall(frame.call_id)
        }
      }
      peer.onconnectionstatechange = handleConnectionStateChange
      peer.oniceconnectionstatechange = handleConnectionStateChange
      peer.ontrack = (event) => {
        const track = event.track
        const streamCount = event.streams?.length ?? 0
        log(
          `remote track received: call_id=${frame.call_id} kind=${track?.kind} receiver=${event.receiver ? 'yes' : 'no'} streams=${streamCount}`
        )
        if (!options.audioSink || track?.kind !== 'audio' || !frame.workspace_id) return
        let startedSession:
          | Promise<WebRtcRemoteAudioSession | null | undefined>
          | WebRtcRemoteAudioSession
          | null
          | undefined
        try {
          startedSession = options.audioSink.start({
            callId: frame.call_id,
            onSpeechStart: () => {
              call.downlinkSession?.interrupt?.()
              call.fileDownlinkSession?.interrupt?.()
            },
            receiver: event.receiver,
            streams: event.streams,
            track,
            workspaceId: frame.workspace_id,
          })
        } catch (error) {
          log(`audio sink start failed: call_id=${frame.call_id}`, error)
          closeCallWithBye(frame.call_id, context)
          return
        }
        if (startedSession && typeof (startedSession as Promise<unknown>).then !== 'function') {
          const audioSession = startedSession as WebRtcRemoteAudioSession
          log(
            `audio sink started: call_id=${frame.call_id} track_kind=${track.kind} receiver=${event.receiver ? 'yes' : 'no'} streams=${streamCount}`
          )
          if (call.closed) {
            void Promise.resolve(audioSession.close()).catch(() => {})
          } else {
            call.audioSessions.add(audioSession)
          }
          return
        }
        void Promise.resolve(startedSession)
          .then((audioSession) => {
            if (!audioSession) return
            log(
              `audio sink started: call_id=${frame.call_id} track_kind=${track.kind} receiver=${event.receiver ? 'yes' : 'no'} streams=${streamCount}`
            )
            if (call.closed) {
              void Promise.resolve(audioSession.close()).catch(() => {})
              return
            }
            call.audioSessions.add(audioSession)
          })
          .catch((error) => {
            log(`audio sink start failed: call_id=${frame.call_id}`, error)
            closeCallWithBye(frame.call_id, context)
          })
      }
      try {
        if (!frame.sdp) throw new Error('WebRTC offer SDP is required')
        await peer.setRemoteDescription({ sdp: frame.sdp, type: 'offer' })
        const answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)
        log(`answer created and sent: call_id=${frame.call_id} sdp_len=${answer.sdp?.length ?? 0}`)
        context.send({
          call_id: frame.call_id,
          kind: 'answer',
          sdp: answer.sdp,
          sdp_type: 'answer',
          type: 'webrtc_signal',
        })
      } catch (error) {
        log(`offer processing failed: call_id=${frame.call_id}`, error)
        closeCall(frame.call_id)
        throw error
      }
      return true
    }

    if (frame.kind === 'ice') {
      const call = calls.get(frame.call_id)
      if (call && frame.candidate) {
        log(
          `remote ICE candidate received: call_id=${frame.call_id} candidate=${frame.candidate.candidate?.substring(0, 80) ?? 'null'}...`
        )
        try {
          await call.peer.addIceCandidate(frame.candidate)
        } catch (error) {
          log(`addIceCandidate failed: call_id=${frame.call_id}`, error)
          closeCall(frame.call_id)
          throw error
        }
      }
      return true
    }

    if (frame.kind === 'bye') {
      log(`bye received: call_id=${frame.call_id}`)
      closeCall(frame.call_id)
      return true
    }

    return true
  }

  return { getActiveWorkspaceCallIds, handleSignal, hasActiveCall, hasActiveWorkspaceCall }
}
