import { describe, expect, test } from 'vitest'

import {
  formatRelayConnectorLogLine,
  toRelayConnectorDiagnosticEvent,
} from '../../src/server/relay-connector-observability.js'

describe('relay connector observability', () => {
  test('formats structured handshake failures without leaking device tokens', () => {
    const event = toRelayConnectorDiagnosticEvent({
      deviceId: 'device-abcdef123456',
      error: new Error('signature check failed for device-token-secret'),
      errorCode: 'handshake_failed',
      event: 'handshake_failed',
      protocolVersion: 2,
      roomId: 'room-1',
      secretValues: ['device-token-secret'],
    })

    expect(event).toEqual({
      device_id: 'device-abcdef123456',
      error_code: 'handshake_failed',
      error_message: 'signature check failed for [REDACTED]',
      event: 'handshake_failed',
      protocol_version: 'v2',
      room_id: 'room-1',
    })
    expect(formatRelayConnectorLogLine(event)).toBe(
      'relay_connector event=handshake_failed room_id=room-1 device_id=device-abcdef123456 protocol_version=v2 error_code=handshake_failed error_message="signature check failed for [REDACTED]"'
    )
  })

  test('keeps success events compact and structured', () => {
    const event = toRelayConnectorDiagnosticEvent({
      deviceId: 'device-1',
      event: 'handshake_ok',
      protocolVersion: 1,
      roomId: 'room-1',
      secretValues: [],
    })

    expect(event).toEqual({
      device_id: 'device-1',
      event: 'handshake_ok',
      protocol_version: 'v1',
      room_id: 'room-1',
    })
    expect(formatRelayConnectorLogLine(event)).toBe(
      'relay_connector event=handshake_ok room_id=room-1 device_id=device-1 protocol_version=v1'
    )
  })
})
