type WebRtcAudioInterlockInput<T> = {
  isExpoRecordingActive: () => boolean
  restoreExpoRecording: () => Promise<void>
  runSession: () => Promise<T>
  setExpoRecordingAudioMode: (allowsRecording: boolean) => Promise<void>
  shouldRestoreExpoRecording: () => boolean
  stopExpoRecording: () => Promise<void>
}

type WebRtcAudioInterlockSessionInput<T> = Omit<WebRtcAudioInterlockInput<T>, 'runSession'> & {
  startSession: () => Promise<T>
}

export type WebRtcAudioInterlockSession<T> = {
  close: () => Promise<void>
  result: T
}

export const runWithWebRtcAudioInterlock = async <T>({
  isExpoRecordingActive,
  restoreExpoRecording,
  runSession,
  setExpoRecordingAudioMode,
  shouldRestoreExpoRecording,
  stopExpoRecording,
}: WebRtcAudioInterlockInput<T>): Promise<T> => {
  const wasExpoRecordingActive = isExpoRecordingActive()
  if (wasExpoRecordingActive) {
    await stopExpoRecording()
    await setExpoRecordingAudioMode(false)
  }

  try {
    return await runSession()
  } finally {
    if (wasExpoRecordingActive && shouldRestoreExpoRecording()) {
      await setExpoRecordingAudioMode(true)
      await restoreExpoRecording()
    }
  }
}

export const startWebRtcAudioInterlockSession = async <T>({
  isExpoRecordingActive,
  restoreExpoRecording,
  setExpoRecordingAudioMode,
  shouldRestoreExpoRecording,
  startSession,
  stopExpoRecording,
}: WebRtcAudioInterlockSessionInput<T>): Promise<WebRtcAudioInterlockSession<T>> => {
  const wasExpoRecordingActive = isExpoRecordingActive()
  let closed = false

  const close = async () => {
    if (closed) return
    closed = true
    if (wasExpoRecordingActive && shouldRestoreExpoRecording()) {
      await setExpoRecordingAudioMode(true)
      await restoreExpoRecording()
    }
  }

  if (wasExpoRecordingActive) {
    await stopExpoRecording()
    await setExpoRecordingAudioMode(false)
  }

  try {
    const result = await startSession()
    return { close, result }
  } catch (error) {
    await close()
    throw error
  }
}
