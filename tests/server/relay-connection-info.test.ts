import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { decodeBase64 } from '../../packages/relay-crypto/src/index.js'
import { loadRelayConnectionInfo } from '../../src/server/relay-config.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const makeDataDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-relay-info-'))
  tempDirs.push(dir)
  return dir
}

describe('loadRelayConnectionInfo', () => {
  test('returns enabled:false when relay.json is absent', async () => {
    const info = await loadRelayConnectionInfo({ dataDir: makeDataDir() })
    expect(info).toEqual({ enabled: false })
  })

  test('returns enabled:false when relay.json has enabled:false', async () => {
    const dir = makeDataDir()
    writeFileSync(join(dir, 'relay.json'), JSON.stringify({ enabled: false }), 'utf8')
    const info = await loadRelayConnectionInfo({ dataDir: dir })
    expect(info).toEqual({ enabled: false })
  })

  test('returns relay_url/room_id/auth token + a real daemon public key when configured', async () => {
    const dir = makeDataDir()
    writeFileSync(
      join(dir, 'relay.json'),
      JSON.stringify({
        enabled: true,
        relay_auth_token: 'relay-secret',
        relay_url: 'wss://relay.example.com',
        room_id: 'room-1',
        runtime_id: 'runtime-1',
      }),
      'utf8'
    )

    const info = await loadRelayConnectionInfo({ dataDir: dir })
    expect(info.enabled).toBe(true)
    if (!info.enabled) throw new Error('expected enabled')
    expect(info.relay_url).toBe('wss://relay.example.com')
    expect(info.room_id).toBe('room-1')
    expect(info.relay_auth_token).toBe('relay-secret')
    expect(info.relay_protocol_version).toBe(2)
    expect(info.room_auth_token).not.toBe('relay-secret')
    // The public key must be a valid 32-byte NaCl box key (auto-generated on first load).
    expect(decodeBase64(info.daemon_public_key)).toHaveLength(32)
    expect(decodeBase64(info.daemon_signing_public_key)).toHaveLength(32)
  })

  test('does not expose the daemon secret key', async () => {
    const dir = makeDataDir()
    writeFileSync(
      join(dir, 'relay.json'),
      JSON.stringify({
        enabled: true,
        relay_auth_token: 'relay-secret',
        relay_url: 'wss://relay.example.com',
        room_id: 'room-1',
        runtime_id: 'runtime-1',
      }),
      'utf8'
    )
    const info = await loadRelayConnectionInfo({ dataDir: dir })
    expect(JSON.stringify(info)).not.toContain('secretKey')
    expect(Object.keys(info)).not.toContain('daemon_keypair')
  })
})
