import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  FeishuCredentialsError,
  loadFeishuCredentials,
} from '../../src/server/feishu-credentials.js'

describe('loadFeishuCredentials', () => {
  let dataDir: string

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'hive-feishu-creds-'))
  })

  afterEach(() => {
    rmSync(dataDir, { force: true, recursive: true })
  })

  test('returns null when feishu.json does not exist', () => {
    expect(loadFeishuCredentials({ dataDir })).toBeNull()
  })

  test('reads valid snake_case credentials', () => {
    writeFileSync(
      join(dataDir, 'feishu.json'),
      JSON.stringify({ app_id: 'cli_abc', app_secret: 'shh' })
    )
    expect(loadFeishuCredentials({ dataDir })).toEqual({ appId: 'cli_abc', appSecret: 'shh' })
  })

  test('reads valid camelCase credentials', () => {
    writeFileSync(
      join(dataDir, 'feishu.json'),
      JSON.stringify({ appId: 'cli_abc', appSecret: 'shh' })
    )
    expect(loadFeishuCredentials({ dataDir })).toEqual({ appId: 'cli_abc', appSecret: 'shh' })
  })

  test('trims whitespace from credentials', () => {
    writeFileSync(
      join(dataDir, 'feishu.json'),
      JSON.stringify({ app_id: '  cli_abc  ', app_secret: '\tshh\n' })
    )
    expect(loadFeishuCredentials({ dataDir })).toEqual({ appId: 'cli_abc', appSecret: 'shh' })
  })

  test('throws FeishuCredentialsError on malformed JSON', () => {
    writeFileSync(join(dataDir, 'feishu.json'), '{ not valid json')
    expect(() => loadFeishuCredentials({ dataDir })).toThrow(FeishuCredentialsError)
  })

  test('throws when app_id is missing', () => {
    writeFileSync(join(dataDir, 'feishu.json'), JSON.stringify({ app_secret: 'shh' }))
    expect(() => loadFeishuCredentials({ dataDir })).toThrow(/app_id missing/)
  })

  test('throws when app_secret is empty string', () => {
    writeFileSync(
      join(dataDir, 'feishu.json'),
      JSON.stringify({ app_id: 'cli_abc', app_secret: '' })
    )
    expect(() => loadFeishuCredentials({ dataDir })).toThrow(/app_secret missing or empty/)
  })

  test('throws when file content is a JSON array', () => {
    writeFileSync(join(dataDir, 'feishu.json'), JSON.stringify(['cli_abc', 'shh']))
    expect(() => loadFeishuCredentials({ dataDir })).toThrow(/expected JSON object|missing/)
  })

  test('throws FeishuCredentialsError when app_id is a number', () => {
    writeFileSync(
      join(dataDir, 'feishu.json'),
      JSON.stringify({ app_id: 12345, app_secret: 'shh' })
    )
    expect(() => loadFeishuCredentials({ dataDir })).toThrow(FeishuCredentialsError)
  })

  test('throws FeishuCredentialsError when app_id is null', () => {
    writeFileSync(
      join(dataDir, 'feishu.json'),
      JSON.stringify({ app_id: null, app_secret: 'shh' })
    )
    expect(() => loadFeishuCredentials({ dataDir })).toThrow(FeishuCredentialsError)
  })

  test('throws FeishuCredentialsError when app_id is a boolean', () => {
    writeFileSync(
      join(dataDir, 'feishu.json'),
      JSON.stringify({ app_id: true, app_secret: 'shh' })
    )
    expect(() => loadFeishuCredentials({ dataDir })).toThrow(FeishuCredentialsError)
  })

  test('throws FeishuCredentialsError when app_secret is a number', () => {
    writeFileSync(
      join(dataDir, 'feishu.json'),
      JSON.stringify({ app_id: 'cli_abc', app_secret: 999 })
    )
    expect(() => loadFeishuCredentials({ dataDir })).toThrow(FeishuCredentialsError)
  })

  test('throws FeishuCredentialsError when file contains JSON null', () => {
    writeFileSync(join(dataDir, 'feishu.json'), 'null')
    expect(() => loadFeishuCredentials({ dataDir })).toThrow(FeishuCredentialsError)
  })

  test('throws FeishuCredentialsError when file contains empty JSON object', () => {
    writeFileSync(join(dataDir, 'feishu.json'), '{}')
    expect(() => loadFeishuCredentials({ dataDir })).toThrow(/app_id missing/)
  })

  test('prefers snake_case app_id over camelCase when both present', () => {
    writeFileSync(
      join(dataDir, 'feishu.json'),
      JSON.stringify({ app_id: 'snake', appId: 'camel', app_secret: 'shh' })
    )
    const result = loadFeishuCredentials({ dataDir })
    expect(result?.appId).toBe('snake')
  })

  test('throws FeishuCredentialsError when file has UTF-8 BOM prefix', () => {
    const bom = '\uFEFF'
    writeFileSync(
      join(dataDir, 'feishu.json'),
      bom + JSON.stringify({ app_id: 'cli_abc', app_secret: 'shh' })
    )
    expect(() => loadFeishuCredentials({ dataDir })).toThrow(FeishuCredentialsError)
  })

  test('throws FeishuCredentialsError for non-ENOENT read failure', () => {
    if (process.platform === 'win32') return
    const filePath = join(dataDir, 'feishu.json')
    writeFileSync(filePath, JSON.stringify({ app_id: 'x', app_secret: 'y' }))
    chmodSync(filePath, 0o000)
    try {
      expect(() => loadFeishuCredentials({ dataDir })).toThrow(FeishuCredentialsError)
    } finally {
      chmodSync(filePath, 0o644)
    }
  })
})
