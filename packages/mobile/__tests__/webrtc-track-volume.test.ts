import { describe, expect, test, vi } from 'vitest'

import {
  applyWebRtcDownlinkVolumeToRefs,
  clampWebRtcDownlinkVolume,
  DEFAULT_WEBRTC_DOWNLINK_VOLUME,
  parseStoredWebRtcDownlinkVolume,
} from '../src/lib/webrtc-track-volume.js'

describe('WebRTC track volume helpers', () => {
  test('applies volume to direct remote audio tracks', () => {
    const setVolume = vi.fn()
    const result = applyWebRtcDownlinkVolumeToRefs([{ _setVolume: setVolume, kind: 'audio' }], 2.4)

    expect(result).toEqual({ applied: 1, failed: 0, unsupported: 0 })
    expect(setVolume).toHaveBeenCalledWith(2.4)
  })

  test('applies volume to audio tracks nested in remote streams', () => {
    const setVolume = vi.fn()
    const result = applyWebRtcDownlinkVolumeToRefs(
      [
        {
          getAudioTracks: () => [{ _setVolume: setVolume, kind: 'audio' }],
        },
      ],
      3
    )

    expect(result.applied).toBe(1)
    expect(setVolume).toHaveBeenCalledWith(3)
  })

  test('does not throw when _setVolume is unavailable or fails', () => {
    const failingSetVolume = vi.fn(() => {
      throw new Error('native volume failed')
    })

    expect(() =>
      applyWebRtcDownlinkVolumeToRefs(
        [{ kind: 'audio' }, { _setVolume: failingSetVolume, kind: 'audio' }],
        2
      )
    ).not.toThrow()

    expect(failingSetVolume).toHaveBeenCalledWith(2)
    expect(
      applyWebRtcDownlinkVolumeToRefs(
        [{ kind: 'audio' }, { _setVolume: failingSetVolume, kind: 'audio' }],
        2
      )
    ).toEqual({ applied: 0, failed: 1, unsupported: 1 })
  })

  test('clamps and parses persisted volume values', () => {
    expect(clampWebRtcDownlinkVolume(-1)).toBe(0.5)
    expect(clampWebRtcDownlinkVolume(8)).toBe(5)
    expect(clampWebRtcDownlinkVolume(2.26)).toBe(2.3)
    expect(parseStoredWebRtcDownlinkVolume('3.2')).toBe(3.2)
    expect(parseStoredWebRtcDownlinkVolume('bad')).toBe(DEFAULT_WEBRTC_DOWNLINK_VOLUME)
  })
})
