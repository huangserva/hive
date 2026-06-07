export const WEBRTC_DOWNLINK_VOLUME_MIN = 0.5
export const WEBRTC_DOWNLINK_VOLUME_MAX = 5
export const DEFAULT_WEBRTC_DOWNLINK_VOLUME = 2

type WebRtcVolumeTrack = {
  _setVolume?: (volume: number) => void
  getAudioTracks?: () => unknown[]
  kind?: string
}

export type WebRtcVolumeApplyResult = {
  applied: number
  failed: number
  unsupported: number
}

export const clampWebRtcDownlinkVolume = (volume: number) => {
  if (!Number.isFinite(volume)) return DEFAULT_WEBRTC_DOWNLINK_VOLUME
  const clamped = Math.min(WEBRTC_DOWNLINK_VOLUME_MAX, Math.max(WEBRTC_DOWNLINK_VOLUME_MIN, volume))
  return Math.round(clamped * 10) / 10
}

export const parseStoredWebRtcDownlinkVolume = (value: string | null) => {
  if (!value) return DEFAULT_WEBRTC_DOWNLINK_VOLUME
  return clampWebRtcDownlinkVolume(Number.parseFloat(value))
}

const collectAudioTracks = (ref: unknown, tracks: WebRtcVolumeTrack[], seen: Set<unknown>) => {
  if (!ref || typeof ref !== 'object' || seen.has(ref)) return
  seen.add(ref)
  const candidate = ref as WebRtcVolumeTrack
  if (candidate.kind === 'audio') {
    tracks.push(candidate)
    return
  }
  const streamTracks = candidate.getAudioTracks?.()
  if (!Array.isArray(streamTracks)) return
  for (const track of streamTracks) collectAudioTracks(track, tracks, seen)
}

export const applyWebRtcDownlinkVolumeToRefs = (
  refs: unknown[],
  volume: number
): WebRtcVolumeApplyResult => {
  const tracks: WebRtcVolumeTrack[] = []
  const seen = new Set<unknown>()
  for (const ref of refs) collectAudioTracks(ref, tracks, seen)

  let applied = 0
  let failed = 0
  let unsupported = 0
  const nextVolume = clampWebRtcDownlinkVolume(volume)
  for (const track of tracks) {
    if (typeof track._setVolume !== 'function') {
      unsupported += 1
      continue
    }
    try {
      track._setVolume(nextVolume)
      applied += 1
    } catch {
      failed += 1
    }
  }
  return { applied, failed, unsupported }
}
