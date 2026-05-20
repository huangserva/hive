import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { createHiveLogger } from '../../src/server/logger.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

describe('hive file logger', () => {
  test('writes timestamped lines to the runtime port log file', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-logger-'))
    tempDirs.push(dataDir)
    const logger = createHiveLogger({ dataDir, port: 4010 })

    logger.info('runtime started port=4010')
    logger.error('uncaughtException', new Error('LOGGER_TEST'))
    await logger.close()

    const logPath = join(dataDir, 'logs', 'runtime-4010.log')
    const text = readFileSync(logPath, 'utf8')

    expect(text).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[info\] runtime started port=4010/m
    )
    expect(text).toContain('[error] uncaughtException')
    expect(text).toContain('Error: LOGGER_TEST')
    expect(text).toContain('tests/unit/logger.test.ts')
  })

  test('HIVE_LOG=0 disables file creation', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hive-logger-disabled-'))
    tempDirs.push(dataDir)
    const logger = createHiveLogger({ dataDir, env: { HIVE_LOG: '0' }, port: 4010 })

    logger.info('runtime started port=4010')
    await logger.close()

    expect(existsSync(join(dataDir, 'logs', 'runtime-4010.log'))).toBe(false)
  })
})
