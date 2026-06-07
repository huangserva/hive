export type WebRtcInCallManager = {
  setForceSpeakerphoneOn: (enabled: boolean) => void
  start: (options: { auto: false; media: 'audio' }) => void
  stop: () => void
}

export type WebRtcInCallAudioRoute = {
  stop: () => Promise<void>
}

export type WebRtcAudioRouteMode = 'incall' | 'media'

export type WebRtcAudioRouteExtra = {
  webRtcAudioRoute?: unknown
}

type StartWebRtcInCallAudioRouteOptions = {
  audioRoute?: WebRtcAudioRouteMode
  loadManager?: () => Promise<WebRtcInCallManager>
}

export const resolveWebRtcAudioRoute = (
  extra: WebRtcAudioRouteExtra | undefined,
  env: Record<string, unknown> = process.env
): WebRtcAudioRouteMode => {
  const value =
    extra?.webRtcAudioRoute ?? env.EXPO_PUBLIC_WEBRTC_AUDIO_ROUTE ?? env.WEBRTC_AUDIO_ROUTE
  return value === 'media' ? 'media' : 'incall'
}

const loadReactNativeInCallManager = async (): Promise<WebRtcInCallManager> => {
  const moduleName = 'react-native-incall-manager'
  const module = (await import(moduleName)) as {
    default?: Partial<WebRtcInCallManager>
  } & Partial<WebRtcInCallManager>
  const manager = module.default ?? module
  if (
    typeof manager.start !== 'function' ||
    typeof manager.stop !== 'function' ||
    typeof manager.setForceSpeakerphoneOn !== 'function'
  ) {
    throw new Error('react-native-incall-manager is unavailable')
  }
  return manager as WebRtcInCallManager
}

export const startWebRtcInCallAudioRoute = async ({
  audioRoute = 'incall',
  loadManager = loadReactNativeInCallManager,
}: StartWebRtcInCallAudioRouteOptions = {}): Promise<WebRtcInCallAudioRoute> => {
  if (audioRoute === 'media') {
    console.log('[WEBRTCDBG] test_call_audio_route_media')
    return {
      stop: async () => {},
    }
  }
  const manager = await loadManager()
  let stopped = false
  let started = false
  try {
    manager.start({ auto: false, media: 'audio' })
    started = true
    manager.setForceSpeakerphoneOn(true)
  } catch (error) {
    if (started) {
      try {
        manager.setForceSpeakerphoneOn(false)
      } catch {}
      try {
        manager.stop()
      } catch {}
    }
    throw error
  }
  return {
    stop: async () => {
      if (stopped) return
      stopped = true
      try {
        manager.setForceSpeakerphoneOn(false)
      } catch {
      } finally {
        try {
          manager.stop()
        } catch {}
      }
    },
  }
}
