import { describe, expect, test } from 'vitest'

import { runWebRtcConnectionProbeSession } from '../src/lib/webrtc-connection-probe'

describe('WebRTC connection probe session', () => {
  test('closes the session after a successful connection probe', async () => {
    const events: string[] = []

    const result = await runWebRtcConnectionProbeSession(async () => ({
      callId: 'call-ok',
      close: () => {
        events.push('close')
      },
      waitForConnected: async (timeoutMs) => {
        events.push(`wait:${timeoutMs}`)
      },
    }))

    expect(result).toEqual({ callId: 'call-ok', ok: true })
    expect(events).toEqual(['wait:15000', 'close'])
  })

  test('closes the session when waitForConnected times out', async () => {
    const events: string[] = []

    const result = await runWebRtcConnectionProbeSession(async () => ({
      callId: 'call-timeout',
      close: () => {
        events.push('close')
      },
      waitForConnected: async () => {
        events.push('wait')
        throw new Error('WebRTC connection timed out')
      },
    }))

    expect(result).toEqual({
      callId: 'call-timeout',
      ok: false,
      reason: 'WebRTC connection timed out',
    })
    expect(events).toEqual(['wait', 'close'])
  })
})
