import type { RelayTransport } from '../api/relay-transport'
import {
  createWebRtcSignalFrame,
  nextWebRtcCallId,
  type WebRtcIceCandidateInit,
  type WebRtcSignalFrame,
} from '../api/webrtc-signal-protocol'

export interface WebRtcIceServer {
  credential?: string
  urls: string | string[]
  username?: string
}

type WebRtcPeerConnection = {
  addIceCandidate(candidate: WebRtcIceCandidateInit): Promise<void> | void
  close(): void
  connectionState?: string
  createOffer(): Promise<{ sdp: string; type: 'offer' }>
  onconnectionstatechange?: (() => void) | null
  onicecandidate: ((event: { candidate: unknown | null }) => void) | null
  setLocalDescription(description: { sdp: string; type: 'offer' }): Promise<void> | void
  setRemoteDescription(description: { sdp: string; type: 'answer' }): Promise<void> | void
}

export interface WebRtcRuntime {
  RTCPeerConnection: new (config: { iceServers: WebRtcIceServer[] }) => WebRtcPeerConnection
}

export interface WebRtcCallerOptions {
  loadRuntime?: () => Promise<WebRtcRuntime>
  nextCallId?: () => string
  transport: Pick<RelayTransport, 'call' | 'onWebRtcSignalFrame' | 'sendWebRtcSignalFrame'>
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

const loadReactNativeWebRtc = async (): Promise<WebRtcRuntime> => {
  const moduleName = 'react-native-webrtc'
  const module = (await import(moduleName)) as {
    default?: { RTCPeerConnection?: WebRtcRuntime['RTCPeerConnection'] }
    RTCPeerConnection?: WebRtcRuntime['RTCPeerConnection']
  }
  const RTCPeerConnection = module.RTCPeerConnection ?? module.default?.RTCPeerConnection
  if (!RTCPeerConnection) throw new Error('react-native-webrtc RTCPeerConnection is unavailable')
  return { RTCPeerConnection }
}

export const createWebRtcCaller = (options: WebRtcCallerOptions) => {
  const loadRuntime = options.loadRuntime ?? loadReactNativeWebRtc
  const nextCallId = options.nextCallId ?? nextWebRtcCallId

  const start = async () => {
    const { iceServers } = await options.transport.call<{ iceServers: WebRtcIceServer[] }>(
      'voice.webrtc.iceConfig'
    )
    const runtime = await loadRuntime()
    const callId = nextCallId()
    const peer = new runtime.RTCPeerConnection({ iceServers })
    let unsubscribe = () => {}
    let closed = false
    let resolveConnected: (() => void) | null = null
    let rejectConnected: ((error: Error) => void) | null = null

    const close = () => {
      if (closed) return
      closed = true
      unsubscribe()
      peer.close()
    }

    peer.onicecandidate = (event) => {
      options.transport.sendWebRtcSignalFrame(
        createWebRtcSignalFrame('ice', callId, {
          candidate: normalizeIceCandidate(event.candidate),
        })
      )
    }

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {
        resolveConnected?.()
        resolveConnected = null
        rejectConnected = null
        return
      }
      if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
        rejectConnected?.(new Error(`WebRTC connection ${peer.connectionState}`))
        resolveConnected = null
        rejectConnected = null
      }
    }

    unsubscribe = options.transport.onWebRtcSignalFrame(async (frame: WebRtcSignalFrame) => {
      if (frame.call_id !== callId || closed) return
      if (frame.kind === 'answer') {
        if (!frame.sdp) throw new Error('WebRTC answer SDP is required')
        await peer.setRemoteDescription({ sdp: frame.sdp, type: 'answer' })
        return
      }
      if (frame.kind === 'ice') {
        if (frame.candidate) await peer.addIceCandidate(frame.candidate)
        return
      }
      if (frame.kind === 'bye') close()
    })

    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    options.transport.sendWebRtcSignalFrame(
      createWebRtcSignalFrame('offer', callId, { sdp: offer.sdp })
    )

    return {
      callId,
      close: () => {
        if (!closed) {
          options.transport.sendWebRtcSignalFrame(createWebRtcSignalFrame('bye', callId))
        }
        close()
      },
      peerConnection: peer,
      waitForConnected: (timeoutMs = 15_000) => {
        if (peer.connectionState === 'connected') return Promise.resolve()
        return new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            if (rejectConnected === reject) {
              resolveConnected = null
              rejectConnected = null
            }
            reject(new Error('WebRTC connection timed out'))
          }, timeoutMs)
          resolveConnected = () => {
            clearTimeout(timer)
            resolve()
          }
          rejectConnected = (error) => {
            clearTimeout(timer)
            reject(error)
          }
        })
      },
    }
  }

  return { start }
}
