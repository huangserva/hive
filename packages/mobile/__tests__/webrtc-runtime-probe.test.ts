import { describe, expect, test, vi } from 'vitest'

import { runWebRtcRuntimeProbe } from '../src/lib/webrtc-runtime-probe'

describe('WebRTC runtime probe', () => {
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
