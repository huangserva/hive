import { createUuid as createRobustUuid } from './uuid'

export type WebRtcSignalKind = 'answer' | 'bye' | 'ice' | 'offer'

export interface WebRtcIceCandidateInit {
  candidate?: string
  sdpMLineIndex?: number | null
  sdpMid?: string | null
  usernameFragment?: string | null
}

export interface WebRtcSignalFrame {
  call_id: string
  candidate?: WebRtcIceCandidateInit | null
  kind: WebRtcSignalKind
  sdp?: string
  sdp_type?: 'answer' | 'offer'
  sent_at_ms?: number
  type: 'webrtc_signal'
  workspace_id?: string
}

const WEBRTC_SIGNAL_KINDS = new Set<WebRtcSignalKind>(['answer', 'bye', 'ice', 'offer'])

const isIceCandidate = (value: unknown): value is WebRtcIceCandidateInit | null => {
  if (value === null) return true
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as WebRtcIceCandidateInit
  return (
    (candidate.candidate === undefined || typeof candidate.candidate === 'string') &&
    (candidate.sdpMid === undefined ||
      candidate.sdpMid === null ||
      typeof candidate.sdpMid === 'string') &&
    (candidate.sdpMLineIndex === undefined ||
      candidate.sdpMLineIndex === null ||
      typeof candidate.sdpMLineIndex === 'number') &&
    (candidate.usernameFragment === undefined ||
      candidate.usernameFragment === null ||
      typeof candidate.usernameFragment === 'string')
  )
}

export const isWebRtcSignalFrame = (value: unknown): value is WebRtcSignalFrame => {
  if (typeof value !== 'object' || value === null) return false
  const frame = value as WebRtcSignalFrame
  if (frame.type !== 'webrtc_signal') return false
  if (typeof frame.call_id !== 'string' || frame.call_id.length === 0) return false
  if (typeof frame.kind !== 'string' || !WEBRTC_SIGNAL_KINDS.has(frame.kind as WebRtcSignalKind)) {
    return false
  }
  if (frame.kind === 'offer' || frame.kind === 'answer') {
    return (
      typeof frame.sdp === 'string' &&
      frame.sdp.length > 0 &&
      frame.sdp_type === frame.kind &&
      (frame.sent_at_ms === undefined || typeof frame.sent_at_ms === 'number') &&
      (frame.workspace_id === undefined || typeof frame.workspace_id === 'string')
    )
  }
  if (frame.kind === 'ice') {
    return (
      'candidate' in frame &&
      isIceCandidate(frame.candidate) &&
      (frame.sent_at_ms === undefined || typeof frame.sent_at_ms === 'number')
    )
  }
  return frame.kind === 'bye'
}

export const createWebRtcSignalFrame = (
  kind: WebRtcSignalKind,
  callId: string,
  input: Omit<Partial<WebRtcSignalFrame>, 'call_id' | 'kind' | 'type'> = {}
): WebRtcSignalFrame => {
  const frame: WebRtcSignalFrame = {
    ...input,
    call_id: callId,
    kind,
    type: 'webrtc_signal',
  }
  if (kind === 'offer' || kind === 'answer') {
    frame.sdp_type = kind
  }
  return frame
}

export const nextWebRtcCallId = (now = Date.now(), createUuid: () => string = createRobustUuid) =>
  `webrtc-${now}-${createUuid()}`
