import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { loadRootEnvFile } from '../../src/cli/hive.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const setupDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hive-env-file-'))
  tempDirs.push(dir)
  return dir
}

describe('hive root env file loading', () => {
  it('loads GLM env from cwd .env without overwriting existing process env', () => {
    const cwd = setupDir()
    mkdirSync(cwd, { recursive: true })
    writeFileSync(
      join(cwd, '.env'),
      [
        '# local fast voice config',
        'GLM_API_KEY=from-file',
        'GLM_BASE_URL=https://open.bigmodel.cn/api/coding/paas/v4',
        'GLM_FAST_MODEL=glm-4-flash',
        'ANTHROPIC_API_KEY=should-not-overwrite',
      ].join('\n'),
      'utf8'
    )
    const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'already-set', NODE_ENV: 'test' }

    loadRootEnvFile({ cwd, env })

    expect(env.GLM_API_KEY).toBe('from-file')
    expect(env.GLM_BASE_URL).toBe('https://open.bigmodel.cn/api/coding/paas/v4')
    expect(env.GLM_FAST_MODEL).toBe('glm-4-flash')
    expect(env.ANTHROPIC_API_KEY).toBe('already-set')
  })

  it('returns false without throwing when .env cannot be read', () => {
    const cwd = setupDir()
    mkdirSync(join(cwd, '.env'), { recursive: true })
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'test' }

    expect(loadRootEnvFile({ cwd, env })).toBe(false)
    expect(env.GLM_API_KEY).toBeUndefined()
    expect(env.NODE_ENV).toBe('test')
  })

  it('returns false without throwing for a malformed .env with no assignments', () => {
    const cwd = setupDir()
    writeFileSync(join(cwd, '.env'), ['not an assignment', '# comment', ''].join('\n'), 'utf8')
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'test' }

    expect(loadRootEnvFile({ cwd, env })).toBe(false)
    expect(env).toEqual({ NODE_ENV: 'test' })
  })
})
