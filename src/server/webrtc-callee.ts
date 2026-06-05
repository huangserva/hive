import type { WebRtcIceCandidateInit, WebRtcSignalFrame } from './webrtc-signal-protocol.js'

export interface WebRtcIceServer {
  credential?: string
  urls: string | string[]
  username?: string
}

type WebRtcPeerConnection = {
  addIceCandidate(candidate: WebRtcIceCandidateInit): Promise<void> | void
  close(): void
  connectionState?: string
  createAnswer(): Promise<{ sdp: string; type: 'answer' }>
  onconnectionstatechange?: (() => void) | null
  onicecandidate: ((event: { candidate: unknown | null }) => void) | null
  setLocalDescription(description: { sdp: string; type: 'answer' }): Promise<void> | void
  setRemoteDescription(description: { sdp: string; type: 'offer' }): Promise<void> | void
}

export interface WebRtcRuntime {
  RTCPeerConnection: new (config: { iceServers: WebRtcIceServer[] }) => WebRtcPeerConnection
}

export interface WebRtcCalleeContext {
  send(frame: WebRtcSignalFrame): void
}

export interface WebRtcCalleeOptions {
  callTimeoutMs?: number
  getIceServers: () => Promise<WebRtcIceServer[]> | WebRtcIceServer[]
  loadRuntime?: () => Promise<WebRtcRuntime>
}

type WebRtcCall = {
  peer: WebRtcPeerConnection
  timer: ReturnType<typeof setTimeout> | null
}

const DEFAULT_WEBRTC_CALL_TIMEOUT_MS = 45_000

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

const loadWeriftRuntime = async (): Promise<WebRtcRuntime> => {
  const moduleName = 'werift'
  const runtime = (await import(moduleName)) as {
    RTCPeerConnection?: WebRtcRuntime['RTCPeerConnection']
  }
  if (!runtime.RTCPeerConnection) {
    throw new Error('werift RTCPeerConnection is unavailable')
  }
  return { RTCPeerConnection: runtime.RTCPeerConnection }
}

export const createWebRtcCallee = (options: WebRtcCalleeOptions) => {
  const loadRuntime = options.loadRuntime ?? loadWeriftRuntime
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
    clearCallTimer(call)
    call.peer.close()
    calls.delete(callId)
  }

  const rememberCall = (callId: string, peer: WebRtcPeerConnection) => {
    const call: WebRtcCall = {
      peer,
      timer: setTimeout(() => closeCall(callId), callTimeoutMs),
    }
    calls.set(callId, call)
    return call
  }

  const handleSignal = async (
    frame: WebRtcSignalFrame,
    context: WebRtcCalleeContext
  ): Promise<boolean> => {
    if (frame.kind === 'offer') {
      closeCall(frame.call_id)
      const [runtime, iceServers] = await Promise.all([loadRuntime(), options.getIceServers()])
      const peer = new runtime.RTCPeerConnection({ iceServers })
      const call = rememberCall(frame.call_id, peer)
      peer.onicecandidate = (event) => {
        context.send({
          call_id: frame.call_id,
          candidate: normalizeIceCandidate(event.candidate),
          kind: 'ice',
          type: 'webrtc_signal',
        })
      }
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') {
          clearCallTimer(call)
          return
        }
        if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
          closeCall(frame.call_id)
        }
      }
      try {
        if (!frame.sdp) throw new Error('WebRTC offer SDP is required')
        await peer.setRemoteDescription({ sdp: frame.sdp, type: 'offer' })
        const answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)
        context.send({
          call_id: frame.call_id,
          kind: 'answer',
          sdp: answer.sdp,
          sdp_type: 'answer',
          type: 'webrtc_signal',
        })
      } catch (error) {
        closeCall(frame.call_id)
        throw error
      }
      return true
    }

    if (frame.kind === 'ice') {
      const call = calls.get(frame.call_id)
      if (call && frame.candidate) {
        try {
          await call.peer.addIceCandidate(frame.candidate)
        } catch (error) {
          closeCall(frame.call_id)
          throw error
        }
      }
      return true
    }

    if (frame.kind === 'bye') {
      closeCall(frame.call_id)
      return true
    }

    return true
  }

  return { handleSignal }
}
