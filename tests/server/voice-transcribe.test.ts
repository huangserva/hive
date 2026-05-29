import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { startTestServer } from '../helpers/test-server.js'
import { getUiCookie } from '../helpers/ui-session.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const createMobileToken = async (
  baseUrl: string,
  capabilities = ['read_dashboard', 'send_prompt']
) => {
  const cookie = await getUiCookie(baseUrl)
  const response = await fetch(`${baseUrl}/api/mobile/tokens`, {
    body: JSON.stringify({ capabilities, name: 'Voice test phone' }),
    headers: { 'content-type': 'application/json', cookie },
    method: 'POST',
  })
  expect(response.status).toBe(200)
  const body = (await response.json()) as { token: string }
  return body.token
}

describe('POST /api/mobile/voice/transcribe', () => {
  test('returns stt_unavailable when whisper is not installed', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-voice-data-'))
    tempDirs.push(dataDir)
    const server = await startTestServer({ dataDir })
    const token = await createMobileToken(server.baseUrl)
    const audioBase64 = Buffer.from('fake audio data').toString('base64')
    const response = await fetch(`${server.baseUrl}/api/mobile/voice/transcribe`, {
      body: JSON.stringify({ audio: audioBase64, format: 'm4a' }),
      headers: {
        authorization: `Bearer ${token}`,
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
    const token = await createMobileToken(server.baseUrl, ['read_dashboard'])
    const audioBase64 = Buffer.from('fake audio').toString('base64')
    const response = await fetch(`${server.baseUrl}/api/mobile/voice/transcribe`, {
      body: JSON.stringify({ audio: audioBase64 }),
      headers: {
        authorization: `Bearer ${token}`,
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
    const token = await createMobileToken(server.baseUrl)
    const response = await fetch(`${server.baseUrl}/api/mobile/voice/transcribe`, {
      body: JSON.stringify({}),
      headers: {
        authorization: `Bearer ${token}`,
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
