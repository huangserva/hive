import { describe, expect, test, vi } from 'vitest'

describe('mobile app config version', () => {
  test('matches the current release version shown in Settings', async () => {
    const { default: config } = await import('../app.config')

    expect(config.version).toBe('2.7.0')
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
})
