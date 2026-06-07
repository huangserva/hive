type MutableRef<T> = { current: T }

export const clearWebRtcFileDownlinkPlaybackResources = ({
  player,
  reassemblers,
}: {
  player: { pause: () => void }
  reassemblers: { clear: () => void }
}) => {
  reassemblers.clear()
  player.pause()
}

export const cleanupWebRtcFileDownlinkResources = ({
  player,
  reassemblers,
  unsubscribeRef,
}: {
  player: { pause: () => void }
  reassemblers: { clear: () => void }
  unsubscribeRef: MutableRef<(() => void) | null>
}) => {
  unsubscribeRef.current?.()
  unsubscribeRef.current = null
  clearWebRtcFileDownlinkPlaybackResources({ player, reassemblers })
}

export const cleanupWebRtcRuntimeCallResources = ({
  audioRouteRef,
  fileDownlink,
  remoteAudioRefsRef,
  sessionRef,
}: {
  audioRouteRef: MutableRef<{ stop: () => Promise<void> | void } | null>
  fileDownlink: Parameters<typeof cleanupWebRtcFileDownlinkResources>[0]
  remoteAudioRefsRef: MutableRef<unknown[]>
  sessionRef: MutableRef<{ close: () => void } | null>
}) => {
  const audioRoute = audioRouteRef.current
  sessionRef.current?.close()
  sessionRef.current = null
  audioRouteRef.current = null
  remoteAudioRefsRef.current = []
  cleanupWebRtcFileDownlinkResources(fileDownlink)
  void Promise.resolve(audioRoute?.stop()).catch(() => {})
}
