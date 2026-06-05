export type WebRtcInCallManager = {
  setForceSpeakerphoneOn: (enabled: boolean) => void
  start: (options: { auto: false; media: 'audio' }) => void
  stop: () => void
}

export type WebRtcInCallAudioRoute = {
  stop: () => Promise<void>
}

type StartWebRtcInCallAudioRouteOptions = {
  loadManager?: () => Promise<WebRtcInCallManager>
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
  loadManager = loadReactNativeInCallManager,
}: StartWebRtcInCallAudioRouteOptions = {}): Promise<WebRtcInCallAudioRoute> => {
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
