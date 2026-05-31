import { describe, expect, test } from 'vitest'

import { resolveConnectionQrFromScanResults } from '../src/lib/connection-qr-scan'

describe('resolveConnectionQrFromScanResults', () => {
  test('returns null when the scan yields no results', () => {
    expect(resolveConnectionQrFromScanResults([])).toBeNull()
  })

  test('returns the first valid HippoTeam QR result from the scan payload', () => {
    expect(
      resolveConnectionQrFromScanResults([
        { data: 'not a qr', type: 'qr_code' } as never,
        { data: JSON.stringify({ host: '192.168.1.5:4010', token: 'tok-1' }), type: 'qr' } as never,
      ])
    ).toEqual({ host: '192.168.1.5:4010', token: 'tok-1' })
  })

  test('ignores scan results that do not decode into a HippoTeam QR', () => {
    expect(
      resolveConnectionQrFromScanResults([
        { data: 'https://example.com', type: 'qr' } as never,
        { data: 'garbage', type: 'qr' } as never,
      ])
    ).toBeNull()
  })
})
