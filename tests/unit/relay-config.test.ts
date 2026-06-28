import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadRelayConfig } from '../../src/server/relay-config.js'

const dirs: string[] = []

const tempDataDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hippoteam-relay-config-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
})

describe('relay config loader', () => {
  it('returns disabled when relay.json is missing', async () => {
    const dataDir = await tempDataDir()

    await expect(loadRelayConfig({ dataDir })).resolves.toEqual({ enabled: false })
  })

  it('defaults daemon relay protocol to v1 for legacy relay servers', async () => {
    const dataDir = await tempDataDir()
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(
        join(dataDir, 'relay.json'),
        JSON.stringify({
          enabled: true,
          relay_auth_token: 'secret',
          relay_url: 'ws://127.0.0.1:8787',
          room_id: 'room-1',
          runtime_id: 'runtime-1',
        })
      )
    )

    const first = await loadRelayConfig({ dataDir })
    const second = await loadRelayConfig({ dataDir })

    expect(first.enabled).toBe(true)
    if (!first.enabled || !second.enabled) throw new Error('expected enabled config')
    expect(first.relay_protocol_version).toBe(1)
    expect(first.room_auth_token).toBeUndefined()
    expect(first.daemon_signing_keypair).toBeUndefined()
    expect(first.daemon_keypair.publicKey.byteLength).toBeGreaterThan(0)
    expect(Array.from(second.daemon_keypair.publicKey)).toEqual(
      Array.from(first.daemon_keypair.publicKey)
    )
  })

  it('keeps v2 available when HIVE_RELAY_PROTOCOL_VERSION=2', async () => {
    const dataDir = await tempDataDir()
    vi.stubEnv('HIVE_RELAY_PROTOCOL_VERSION', '2')
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(
        join(dataDir, 'relay.json'),
        JSON.stringify({
          enabled: true,
          relay_auth_token: 'secret',
          relay_url: 'ws://127.0.0.1:8787',
          room_id: 'room-1',
          runtime_id: 'runtime-1',
        })
      )
    )

    const config = await loadRelayConfig({ dataDir })

    expect(config.enabled).toBe(true)
    if (!config.enabled) throw new Error('expected enabled config')
    expect(config.relay_protocol_version).toBe(2)
    expect(config.daemon_signing_keypair?.publicKey.byteLength).toBe(32)
    expect(config.daemon_signing_keypair?.secretKey.byteLength).toBe(64)
    expect(config.room_auth_token).not.toBe(config.relay_auth_token)
  })
})
