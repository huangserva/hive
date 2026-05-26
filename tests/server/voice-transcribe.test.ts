import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { startTestServer } from '../helpers/test-server.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

describe('POST /api/mobile/voice/transcribe', () => {
  test('returns stt_unavailable when whisper is not installed', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-voice-data-'))
    tempDirs.push(dataDir)
    const server = await startTestServer({ dataDir })
    const pairResponse = await fetch(`${server.baseUrl}/api/mobile/pair`)
    const pair = (await pairResponse.json()) as { token: string }
    const audioBase64 = Buffer.from('fake audio data').toString('base64')
    const response = await fetch(`${server.baseUrl}/api/mobile/voice/transcribe`, {
      body: JSON.stringify({ audio: audioBase64, format: 'm4a' }),
      headers: {
        authorization: `Bearer ${pair.token}`,
        'content-type': 'application/json',
      },
      method: 'POST',
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { error?: string; text?: string }
    expect(body.error).toBe('stt_unavailable')
  })

  test('rejects request with read-only capability', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-voice-data-'))
    tempDirs.push(dataDir)
    const server = await startTestServer({ dataDir })
    const cookie = await (async () => {
      const uiResponse = await fetch(`${server.baseUrl}/api/ui/token`, { method: 'POST' })
      const setCookie = uiResponse.headers.getSetCookie()
      return setCookie[0]?.split(';')[0] ?? ''
    })()
    const codeResponse = await fetch(`${server.baseUrl}/api/mobile/pair/generate`, {
      body: JSON.stringify({
        capabilities: ['read_dashboard'],
        device_name: 'test-phone',
      }),
      headers: { 'content-type': 'application/json', cookie },
      method: 'POST',
    })
    const codeBody = (await codeResponse.json()) as { code: string }
    const redeemResponse = await fetch(`${server.baseUrl}/api/mobile/pair/redeem`, {
      body: JSON.stringify({ code: codeBody.code }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    const redeem = (await redeemResponse.json()) as { token: string }
    const audioBase64 = Buffer.from('fake audio').toString('base64')
    const response = await fetch(`${server.baseUrl}/api/mobile/voice/transcribe`, {
      body: JSON.stringify({ audio: audioBase64 }),
      headers: {
        authorization: `Bearer ${redeem.token}`,
        'content-type': 'application/json',
      },
      method: 'POST',
    })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).toBeLessThan(500)
  })

  test('rejects request without audio field', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-voice-data-'))
    tempDirs.push(dataDir)
    const server = await startTestServer({ dataDir })
    const pairResponse = await fetch(`${server.baseUrl}/api/mobile/pair`)
    const pair = (await pairResponse.json()) as { token: string }
    const response = await fetch(`${server.baseUrl}/api/mobile/voice/transcribe`, {
      body: JSON.stringify({}),
      headers: {
        authorization: `Bearer ${pair.token}`,
        'content-type': 'application/json',
      },
      method: 'POST',
    })
    expect(response.status).toBe(400)
  })

  test('rejects unauthenticated request', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-voice-data-'))
    tempDirs.push(dataDir)
    const server = await startTestServer({ dataDir })
    const response = await fetch(`${server.baseUrl}/api/mobile/voice/transcribe`, {
      body: JSON.stringify({ audio: 'fake' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(response.status).toBe(401)
  })
})
