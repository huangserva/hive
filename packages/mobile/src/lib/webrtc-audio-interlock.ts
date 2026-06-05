type WebRtcAudioInterlockInput<T> = {
  isExpoRecordingActive: () => boolean
  restoreExpoRecording: () => Promise<void>
  runSession: () => Promise<T>
  setExpoRecordingAudioMode: (allowsRecording: boolean) => Promise<void>
  shouldRestoreExpoRecording: () => boolean
  stopExpoRecording: () => Promise<void>
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
