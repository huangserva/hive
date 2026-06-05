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

type WebRtcPeerConnectionConfig = {
  iceServers: WebRtcIceServer[]
  iceTransportPolicy?: 'relay'
}

type WebRtcTrack = {
  stop?: () => void
}

type WebRtcStream = {
  getAudioTracks?: () => WebRtcTrack[]
  getTracks?: () => WebRtcTrack[]
}

type WebRtcPeerConnection = {
  addIceCandidate(candidate: WebRtcIceCandidateInit): Promise<void> | void
  addTrack?: (track: WebRtcTrack, stream: WebRtcStream) => unknown
  close(): void
  connectionState?: string
  createOffer(): Promise<{ sdp: string; type: 'offer' }>
  onconnectionstatechange?: (() => void) | null
  onicecandidate: ((event: { candidate: unknown | null }) => void) | null
  ontrack?: ((event: { streams?: unknown[]; track?: unknown }) => void) | null
  setLocalDescription(description: { sdp: string; type: 'offer' }): Promise<void> | void
  setRemoteDescription(description: { sdp: string; type: 'answer' }): Promise<void> | void
}

export interface WebRtcRuntime {
  mediaDevices?: {
    getUserMedia?: (constraints: { audio: boolean; video: boolean }) => Promise<WebRtcStream>
  }
  RTCPeerConnection: new (config: WebRtcPeerConnectionConfig) => WebRtcPeerConnection
}

export interface WebRtcCallerOptions {
  audio?: boolean
  forceRelay?: boolean
  loadRuntime?: () => Promise<WebRtcRuntime>
  nextCallId?: () => string
  onConnectionClosed?: (event: { callId: string; state: 'closed' | 'failed' }) => void
  onRemoteTrack?: (event: { streams?: unknown[]; track?: unknown }) => void
  runAudioSession?: <T>(
    session: () => Promise<T>
  ) => Promise<{ close: () => Promise<void> | void; result: T }>
  transport: Pick<RelayTransport, 'call' | 'onWebRtcSignalFrame' | 'sendWebRtcSignalFrame'>
  workspaceId?: string
}

export type WebRtcRuntimeExtra = {
  webRtcForceRelay?: unknown
}

const parseEnabledFlag = (value: unknown) => {
  if (value === true) return true
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true'
}

export const resolveWebRtcForceRelayEnabled = (
  extra: WebRtcRuntimeExtra | undefined,
  env: Record<string, unknown> = process.env
) => {
  const value =
    extra?.webRtcForceRelay ?? env.EXPO_PUBLIC_WEBRTC_FORCE_RELAY ?? env.WEBRTC_FORCE_RELAY
  return parseEnabledFlag(value)
}

const createPeerConnectionConfig = (
  iceServers: WebRtcIceServer[],
  forceRelay: boolean
): WebRtcPeerConnectionConfig =>
  forceRelay ? { iceServers, iceTransportPolicy: 'relay' } : { iceServers }

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
    mediaDevices?: WebRtcRuntime['mediaDevices']
    RTCPeerConnection?: WebRtcRuntime['RTCPeerConnection']
  }
  const RTCPeerConnection = module.RTCPeerConnection ?? module.default?.RTCPeerConnection
  if (!RTCPeerConnection) throw new Error('react-native-webrtc RTCPeerConnection is unavailable')
  return { mediaDevices: module.mediaDevices, RTCPeerConnection }
}

export const createWebRtcCaller = (options: WebRtcCallerOptions) => {
  const loadRuntime = options.loadRuntime ?? loadReactNativeWebRtc
  const nextCallId = options.nextCallId ?? nextWebRtcCallId
  const forceRelay = options.forceRelay ?? resolveWebRtcForceRelayEnabled(undefined)
  const runAudioSession =
    options.runAudioSession ??
    (async <T>(session: () => Promise<T>) => ({
      close: () => {},
      result: await session(),
    }))

  const start = async () => {
    let localStream: WebRtcStream | null = null
    let localTracks: WebRtcTrack[] = []
    let unsubscribe = () => {}
    let closed = false
    let callId = ''
    let peer: WebRtcPeerConnection | null = null
    let resolveConnected: (() => void) | null = null
    let rejectConnected: ((error: Error) => void) | null = null
    let audioSessionClosed = false
    let closeAudioSession = () => {}

    function close() {
      if (closed) return
      closed = true
      unsubscribe()
      try {
        for (const track of localTracks) track.stop?.()
        peer?.close()
      } finally {
        closeAudioSession()
      }
    }

    const audioSession = await runAudioSession(async () => {
      try {
        const { iceServers } = await options.transport.call<{ iceServers: WebRtcIceServer[] }>(
          'voice.webrtc.iceConfig'
        )
        const runtime = await loadRuntime()
        callId = nextCallId()
        peer = new runtime.RTCPeerConnection(createPeerConnectionConfig(iceServers, forceRelay))
        if (options.audio) {
          const getUserMedia = runtime.mediaDevices?.getUserMedia
          if (!getUserMedia) {
            throw new Error('react-native-webrtc mediaDevices.getUserMedia is unavailable')
          }
          if (!peer.addTrack) {
            throw new Error('react-native-webrtc RTCPeerConnection.addTrack is unavailable')
          }
          localStream = await getUserMedia({ audio: true, video: false })
          localTracks = localStream.getAudioTracks?.() ?? localStream.getTracks?.() ?? []
          for (const track of localTracks) peer.addTrack(track, localStream)
        }

        peer.onicecandidate = (event) => {
          options.transport.sendWebRtcSignalFrame(
            createWebRtcSignalFrame('ice', callId, {
              candidate: normalizeIceCandidate(event.candidate),
            })
          )
        }
        peer.ontrack = (event) => {
          options.onRemoteTrack?.(event)
        }

        peer.onconnectionstatechange = () => {
          if (!peer) return
          if (peer.connectionState === 'connected') {
            resolveConnected?.()
            resolveConnected = null
            rejectConnected = null
            return
          }
          if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
            const state = peer.connectionState
            rejectConnected?.(new Error(`WebRTC connection ${state}`))
            resolveConnected = null
            rejectConnected = null
            close()
            options.onConnectionClosed?.({ callId, state })
          }
        }

        unsubscribe = options.transport.onWebRtcSignalFrame(async (frame: WebRtcSignalFrame) => {
          if (frame.call_id !== callId || closed || !peer) return
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
          createWebRtcSignalFrame('offer', callId, {
            sdp: offer.sdp,
            ...(options.workspaceId ? { workspace_id: options.workspaceId } : {}),
          })
        )
        return { ok: true as const }
      } catch (error) {
        return { error, ok: false as const }
      }
    })

    closeAudioSession = () => {
      if (audioSessionClosed) return
      audioSessionClosed = true
      void Promise.resolve(audioSession.close()).catch(() => {})
    }
    if (!audioSession.result.ok) {
      const error = audioSession.result.error
      close()
      throw error
    }
    if (!peer) throw new Error('react-native-webrtc RTCPeerConnection was not created')
    const activePeer = peer as WebRtcPeerConnection

    return {
      callId,
      close: () => {
        if (!closed) {
          try {
            options.transport.sendWebRtcSignalFrame(createWebRtcSignalFrame('bye', callId))
          } catch {}
        }
        close()
      },
      peerConnection: activePeer,
      waitForConnected: (timeoutMs = 15_000) => {
        if (activePeer.connectionState === 'connected') return Promise.resolve()
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
