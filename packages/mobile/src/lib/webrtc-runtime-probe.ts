type WebRtcTrack = {
  stop?: () => void
}

type WebRtcStream = {
  getTracks?: () => WebRtcTrack[]
}

type WebRtcPeerConnection = {
  close?: () => void
}

type WebRtcRuntime = {
  mediaDevices?: {
    getUserMedia?: (constraints: { audio: boolean; video: boolean }) => Promise<WebRtcStream>
  }
  RTCPeerConnection?: new () => WebRtcPeerConnection
}

type ReadyWebRtcRuntime = {
  mediaDevices: {
    getUserMedia: (constraints: { audio: boolean; video: boolean }) => Promise<WebRtcStream>
  }
  RTCPeerConnection: new () => WebRtcPeerConnection
}

type ReactNativeRuntime = {
  NativeModules?: Record<string, unknown>
}

export type WebRtcRuntimeProbeResult =
  | { ok: true }
  | {
      ok: false
      reason: string
    }

type WebRtcRuntimeProbeOptions = {
  hasNativeWebRtcModule?: () => Promise<boolean> | boolean
  loadWebRtc?: () => Promise<unknown>
}

const WEBRTC_NATIVE_MODULE_NAME = 'WebRTCModule'

const describeError = (error: unknown) => {
  if (error instanceof Error) return error.message
  return String(error)
}

const defaultHasNativeWebRtcModule = async () => {
  try {
    const reactNative = (await import(/* @vite-ignore */ 'react-native')) as ReactNativeRuntime
    return Boolean(reactNative.NativeModules?.[WEBRTC_NATIVE_MODULE_NAME])
  } catch {
    return false
  }
}

const defaultLoadWebRtc = async () => import(/* @vite-ignore */ 'react-native-webrtc')

const isWebRtcRuntime = (value: unknown): value is ReadyWebRtcRuntime => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as WebRtcRuntime
  return (
    typeof candidate.mediaDevices?.getUserMedia === 'function' &&
    typeof candidate.RTCPeerConnection === 'function'
  )
}

export const runWebRtcRuntimeProbe = async (
  options: WebRtcRuntimeProbeOptions = {}
): Promise<WebRtcRuntimeProbeResult> => {
  const hasNativeWebRtcModule = options.hasNativeWebRtcModule ?? defaultHasNativeWebRtcModule
  const loadWebRtc = options.loadWebRtc ?? defaultLoadWebRtc
  let stream: WebRtcStream | null = null
  let peerConnection: WebRtcPeerConnection | null = null

  try {
    if (!(await hasNativeWebRtcModule())) {
      return { ok: false, reason: `${WEBRTC_NATIVE_MODULE_NAME} native module is unavailable` }
    }

    const runtime = await loadWebRtc()
    if (!isWebRtcRuntime(runtime)) {
      return { ok: false, reason: 'react-native-webrtc mediaDevices.getUserMedia is unavailable' }
    }

    const getUserMedia = runtime.mediaDevices.getUserMedia
    const PeerConnection = runtime.RTCPeerConnection
    stream = await getUserMedia({ audio: true, video: false })
    peerConnection = new PeerConnection()
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: describeError(error) }
  } finally {
    for (const track of stream?.getTracks?.() ?? []) {
      track.stop?.()
    }
    peerConnection?.close?.()
  }
}

export const resolveWebRtcProbeEnabled = (
  extra: { webRtcProbe?: unknown } | undefined,
  env: Record<string, string | undefined> = process.env
) => {
  const value = extra?.webRtcProbe ?? env.EXPO_PUBLIC_WEBRTC_PROBE ?? env.WEBRTC_PROBE
  return value === '1' || value === 'true'
}
