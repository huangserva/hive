import { describe, expect, test } from 'vitest'

import { generateRelaySecrets } from '../../src/keygen.js'

describe('generateRelaySecrets', () => {
  test('produces a high-entropy auth token, room id, and runtime id', () => {
    const secrets = generateRelaySecrets()

    // base64url, no padding/url-unsafe chars.
    expect(secrets.authToken).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(secrets.roomId).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(secrets.runtimeId).toMatch(/^runtime-[0-9a-f-]{36}$/)

    // 32 random bytes → at least ~43 base64url chars; a too-short token would be
    // guessable, so assert real length rather than mere presence.
    expect(secrets.authToken.length).toBeGreaterThanOrEqual(40)
    expect(secrets.roomId.length).toBeGreaterThanOrEqual(12)
  })

  test('generates distinct secrets on each call (not a constant stub)', () => {
    const a = generateRelaySecrets()
    const b = generateRelaySecrets()

    expect(a.authToken).not.toBe(b.authToken)
    expect(a.roomId).not.toBe(b.roomId)
    expect(a.runtimeId).not.toBe(b.runtimeId)
  })
})
