import { describe, expect, test, vi } from 'vitest'
import {
  resolveWebRtcAudioRoute,
  startWebRtcInCallAudioRoute,
} from '../src/lib/webrtc-incall-manager.js'

describe('WebRTC InCallManager audio route', () => {
  test('starts Android call audio mode and forces speakerphone for WebRTC calls', async () => {
    const calls: string[] = []
    const route = await startWebRtcInCallAudioRoute({
      loadManager: async () => ({
        setForceSpeakerphoneOn: (enabled) => calls.push(`speaker:${enabled}`),
        start: (options) => calls.push(`start:${options.media}:${options.auto}`),
        stop: () => calls.push('stop'),
      }),
    })

    expect(calls).toEqual(['start:audio:false', 'speaker:true'])

    await route.stop()

    expect(calls).toEqual(['start:audio:false', 'speaker:true', 'speaker:false', 'stop'])
  })

  test('stops at most once when cleanup runs from failure and user hangup paths', async () => {
    const stop = vi.fn()
    const route = await startWebRtcInCallAudioRoute({
      loadManager: async () => ({
        setForceSpeakerphoneOn: () => {},
        start: () => {},
        stop,
      }),
    })

    await route.stop()
    await route.stop()

    expect(stop).toHaveBeenCalledTimes(1)
  })

  test('cleans up call audio mode when forcing speakerphone fails during startup', async () => {
    const calls: string[] = []
    await expect(
      startWebRtcInCallAudioRoute({
        loadManager: async () => ({
          setForceSpeakerphoneOn: (enabled) => {
            calls.push(`speaker:${enabled}`)
            if (enabled) throw new Error('speaker failed')
          },
          start: () => calls.push('start'),
          stop: () => calls.push('stop'),
        }),
      })
    ).rejects.toThrow('speaker failed')

    expect(calls).toEqual(['start', 'speaker:true', 'speaker:false', 'stop'])
  })

  test('still stops call audio mode when disabling speakerphone fails during cleanup', async () => {
    const calls: string[] = []
    const route = await startWebRtcInCallAudioRoute({
      loadManager: async () => ({
        setForceSpeakerphoneOn: (enabled) => {
          calls.push(`speaker:${enabled}`)
          if (!enabled) throw new Error('speaker disable failed')
        },
        start: () => calls.push('start'),
        stop: () => calls.push('stop'),
      }),
    })

    await route.stop()
    await route.stop()

    expect(calls).toEqual(['start', 'speaker:true', 'speaker:false', 'stop'])
  })

  test('surfaces dynamic import failures so the test call can close its peer and show error', async () => {
    await expect(
      startWebRtcInCallAudioRoute({
        loadManager: async () => {
          throw new Error('react-native-incall-manager unavailable')
        },
      })
    ).rejects.toThrow('react-native-incall-manager unavailable')
  })

  test('skips InCallManager startup and cleanup when WebRTC audio route is media', async () => {
    const calls: string[] = []
    const route = await startWebRtcInCallAudioRoute({
      audioRoute: 'media',
      loadManager: async () => ({
        setForceSpeakerphoneOn: (enabled) => calls.push(`speaker:${enabled}`),
        start: () => calls.push('start'),
        stop: () => calls.push('stop'),
      }),
    })

    await route.stop()

    expect(calls).toEqual([])
  })

  test('resolves WebRTC audio route from explicit extra or build env with incall as default', () => {
    expect(resolveWebRtcAudioRoute({ webRtcAudioRoute: 'media' }, {})).toBe('media')
    expect(resolveWebRtcAudioRoute({ webRtcAudioRoute: 'incall' }, {})).toBe('incall')
    expect(resolveWebRtcAudioRoute(undefined, { EXPO_PUBLIC_WEBRTC_AUDIO_ROUTE: 'media' })).toBe(
      'media'
    )
    expect(resolveWebRtcAudioRoute(undefined, { WEBRTC_AUDIO_ROUTE: 'media' })).toBe('media')
    expect(resolveWebRtcAudioRoute(undefined, { EXPO_PUBLIC_WEBRTC_AUDIO_ROUTE: 'MEDIA' })).toBe(
      'incall'
    )
    expect(resolveWebRtcAudioRoute(undefined, {})).toBe('incall')
  })
})
