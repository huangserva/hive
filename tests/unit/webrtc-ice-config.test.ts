import { describe, expect, test } from 'vitest'

import { resolveWebRtcIceServers } from '../../src/server/relay-rpc-handler.js'

describe('WebRTC ICE config', () => {
  test('uses OpenRelay TURN servers by default for zero-cost development', () => {
    expect(
      resolveWebRtcIceServers({}).some((server) => String(server.urls).startsWith('turn:'))
    ).toBe(true)
  })

  test('uses explicit JSON ICE server configuration when provided', () => {
    expect(
      resolveWebRtcIceServers({
        HIVE_WEBRTC_ICE_SERVERS_JSON: JSON.stringify([
          { credential: 'pass', urls: 'turn:turn.example.test:443', username: 'user' },
        ]),
      })
    ).toEqual([{ credential: 'pass', urls: 'turn:turn.example.test:443', username: 'user' }])
  })

  test('rejects malformed ICE server configuration', () => {
    expect(() =>
      resolveWebRtcIceServers({
        HIVE_WEBRTC_ICE_SERVERS_JSON: JSON.stringify([{ urls: 42 }]),
      })
    ).toThrow('HIVE_WEBRTC_ICE_SERVERS_JSON')
  })
})
