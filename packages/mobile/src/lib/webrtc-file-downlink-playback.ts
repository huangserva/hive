import type { VoiceDownlinkSegmentAudioResult } from '../api/voice-downlink-segment-protocol'

export type WebRtcFileDownlinkPlayer = {
  play: () => void
  replace: (source: { uri: string }) => void
}

export const playWebRtcFileDownlinkSegment = async ({
  player,
  segment,
  setAudioMode,
}: {
  player: WebRtcFileDownlinkPlayer
  segment: Pick<VoiceDownlinkSegmentAudioResult, 'audio' | 'mime'>
  setAudioMode: (mode: { allowsRecording: boolean; playsInSilentMode: boolean }) => Promise<void>
}) => {
  await setAudioMode({
    allowsRecording: false,
    playsInSilentMode: true,
  })
  player.replace({ uri: `data:${segment.mime};base64,${segment.audio}` })
  player.play()
}
