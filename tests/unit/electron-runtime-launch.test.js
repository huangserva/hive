import { describe, expect, test } from 'vitest'

import {
  prepareElectronRuntimeEnv,
  startHiveRuntimeWithPortRetry,
} from '../../desktop/electron/runtime-launch.mjs'

describe('desktop Electron runtime launch', () => {
  test('sets explicit runtime paths before importing the packaged runtime', () => {
    const calls = []
    const env = {}

    prepareElectronRuntimeEnv({
      env,
      repairDesktopPathEnv: (targetEnv) => {
        calls.push(['repairPath', targetEnv === env])
        targetEnv.PATH = '/opt/homebrew/bin:/usr/bin:/bin'
      },
      rootEnvFile: '/Applications/HippoTeam.app/Contents/Resources/app.asar/.env',
      staticDir: '/Applications/HippoTeam.app/Contents/Resources/app.asar/web/dist',
    })

    expect(calls).toEqual([['repairPath', true]])
    expect(env).toMatchObject({
      HIVE_ELECTRON: '1',
      HIVE_ROOT_ENV_FILE: '/Applications/HippoTeam.app/Contents/Resources/app.asar/.env',
      HIVE_STATIC_DIR: '/Applications/HippoTeam.app/Contents/Resources/app.asar/web/dist',
      PATH: '/opt/homebrew/bin:/usr/bin:/bin',
    })
  })

  test('retries the next port when Electron runtime hits EADDRINUSE', async () => {
    const attempts = []
    const runtime = await startHiveRuntimeWithPortRetry({
      runHiveCommand: async (argv) => {
        attempts.push(argv)
        if (attempts.length === 1) {
          const error = new Error('port busy')
          error.code = 'EADDRINUSE'
          error.port = 4010
          throw error
        }
        return { port: Number(argv[1]) }
      },
      startPort: 4010,
    })

    expect(attempts).toEqual([
      ['--port', '4010'],
      ['--port', '4011'],
    ])
    expect(runtime).toEqual({ port: 4011 })
  })
})
