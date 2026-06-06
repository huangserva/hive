import { describe, expect, test, vi } from 'vitest'

import { resolveWebRtcProbeEnabled, runWebRtcRuntimeProbe } from '../src/lib/webrtc-runtime-probe'

describe('WebRTC runtime probe', () => {
  test('shows the WebRTC probe entry by default while keeping an explicit off switch', () => {
    expect(resolveWebRtcProbeEnabled(undefined, {})).toBe(true)
    expect(resolveWebRtcProbeEnabled({ webRtcProbe: '0' }, {})).toBe(false)
    expect(resolveWebRtcProbeEnabled(undefined, { EXPO_PUBLIC_WEBRTC_PROBE: 'false' })).toBe(false)
  })

  test('opens microphone, creates peer connection, then releases resources', async () => {
    const stop = vi.fn()
    const close = vi.fn()
    const getTracks = vi.fn(() => [{ stop }])
    const getUserMedia = vi.fn(async () => ({ getTracks }))
    const RTCPeerConnection = vi.fn(() => ({ close }))

    const result = await runWebRtcRuntimeProbe({
      hasNativeWebRtcModule: async () => true,
      loadWebRtc: async () => ({
        mediaDevices: { getUserMedia },
        RTCPeerConnection,
      }),
    })

    expect(result).toEqual({ ok: true })
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false })
    expect(RTCPeerConnection).toHaveBeenCalledWith()
    expect(getTracks).toHaveBeenCalled()
    expect(stop).toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
  })

  test('runs WebRTC audio acquisition inside the provided interlock', async () => {
    const order: string[] = []
    const getUserMedia = vi.fn(async () => {
      order.push('getUserMedia')
      return { getTracks: () => [] }
    })

    const result = await runWebRtcRuntimeProbe({
      hasNativeWebRtcModule: async () => true,
      loadWebRtc: async () => ({
        mediaDevices: { getUserMedia },
        RTCPeerConnection: vi.fn(() => ({})),
      }),
      runAudioSession: async (session) => {
        order.push('before')
        const sessionResult = await session()
        order.push('after')
        return sessionResult
      },
    })

    expect(result).toEqual({ ok: true })
    expect(order).toEqual(['before', 'getUserMedia', 'after'])
  })

  test('returns a structured failure when WebRTC API is unavailable', async () => {
    const result = await runWebRtcRuntimeProbe({
      hasNativeWebRtcModule: async () => true,
      loadWebRtc: async () => ({ mediaDevices: {} }),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('mediaDevices.getUserMedia')
    }
  })
})
