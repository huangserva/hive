import { describe, expect, test, vi } from 'vitest'

describe('mobile app config version', () => {
  test('matches the current release version shown in Settings', async () => {
    const { default: config } = await import('../app.config')

    expect(config.version).toBe('2.8.15')
  })

  test('injects neural VAD flags into Expo extra from build env', async () => {
    vi.stubEnv('EXPO_PUBLIC_NEURAL_VAD_SHADOW', '1')
    vi.stubEnv('NEURAL_VAD_PCM_PROBE', 'true')
    vi.resetModules()

    const { default: envConfig } = await import('../app.config')

    expect(envConfig.extra).toMatchObject({
      neuralVadPcmProbe: 'true',
      neuralVadShadow: '1',
    })
  })

  test('injects WebRTC force-relay flag into Expo extra from build env', async () => {
    vi.stubEnv('EXPO_PUBLIC_WEBRTC_FORCE_RELAY', '1')
    vi.resetModules()

    const { default: envConfig } = await import('../app.config')

    expect(envConfig.extra).toMatchObject({
      webRtcForceRelay: '1',
    })
  })

  test('injects WebRTC audio route flag into Expo extra from build env', async () => {
    vi.stubEnv('EXPO_PUBLIC_WEBRTC_AUDIO_ROUTE', 'media')
    vi.resetModules()

    const { default: envConfig } = await import('../app.config')

    expect(envConfig.extra).toMatchObject({
      webRtcAudioRoute: 'media',
    })
  })

  test('excludes WebRTC native autolinking by default', async () => {
    vi.unstubAllEnvs()
    vi.resetModules()

    const { default: config } = await import('../app.config')

    expect(config.autolinking?.exclude).toContain('react-native-webrtc')
  })

  test('keeps WebRTC native autolinking available for explicit experiment builds', async () => {
    vi.stubEnv('WEBRTC_NATIVE_REGISTER', '1')
    vi.resetModules()

    const { default: config } = await import('../app.config')

    expect(config.autolinking?.exclude ?? []).not.toContain('react-native-webrtc')
  })
})
