import { describe, expect, test } from 'vitest'

const { resolveWebRtcAutolinkEnabled } = require('../react-native.config')

describe('react-native WebRTC autolinking config', () => {
  test('disables WebRTC autolinking by default and enables it only for experiment builds', () => {
    expect(
      resolveWebRtcAutolinkEnabled({
        EXPO_PUBLIC_WEBRTC_NATIVE_REGISTER: undefined,
        WEBRTC_NATIVE_REGISTER: undefined,
      })
    ).toBe(false)
    expect(
      resolveWebRtcAutolinkEnabled({
        EXPO_PUBLIC_WEBRTC_NATIVE_REGISTER: '1',
        WEBRTC_NATIVE_REGISTER: undefined,
      })
    ).toBe(true)
    expect(
      resolveWebRtcAutolinkEnabled({
        EXPO_PUBLIC_WEBRTC_NATIVE_REGISTER: undefined,
        WEBRTC_NATIVE_REGISTER: 'true',
      })
    ).toBe(true)
  })
})
