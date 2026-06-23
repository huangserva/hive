import { describe, expect, test } from 'vitest'

import { repairDesktopPathEnv, resolveDesktopPathEnv } from '../../desktop/electron/path-env.mjs'

const shellEnvOutput = (entries) =>
  [
    '__HIVE_DESKTOP_ENV_START__',
    ...Object.entries(entries).map(([key, value]) => `${key}=${value}`),
    '__HIVE_DESKTOP_ENV_END__',
  ].join('\n')

describe('desktop Electron PATH repair', () => {
  test('merges login shell PATH with common user CLI locations before runtime starts', () => {
    const calls = []
    const path = resolveDesktopPathEnv({
      env: {
        HOME: '/Users/alice',
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        SHELL: '/bin/zsh',
      },
      execSync: (command, options) => {
        calls.push({ command, options })
        return Buffer.from(shellEnvOutput({ PATH: '/opt/homebrew/bin:/custom/bin:/usr/bin:/bin' }))
      },
      platform: 'darwin',
    })

    expect(calls).toEqual([
      expect.objectContaining({
        command: expect.stringContaining('/bin/zsh'),
        options: expect.objectContaining({ timeout: 2000 }),
      }),
    ])
    expect(calls[0].command).toContain('-l')
    expect(calls[0].command).toContain('-i')
    expect(calls[0].command).toContain('-c')
    const parts = path.split(':')
    expect(parts).toEqual([
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/Users/alice/.local/bin',
      '/Users/alice/.bun/bin',
      '/Users/alice/.npm-global/bin',
      '/custom/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ])
  })

  test('adds installed nvm node version bins when GUI starts with a minimal PATH', () => {
    const path = resolveDesktopPathEnv({
      env: {
        HOME: '/Users/serva',
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        SHELL: '/bin/zsh',
      },
      execSync: () => Buffer.from(shellEnvOutput({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin' })),
      platform: 'darwin',
      readdirSync: (directory, options) => {
        expect(directory).toBe('/Users/serva/.nvm/versions/node')
        expect(options).toEqual({ withFileTypes: true })
        return [
          { isDirectory: () => true, name: 'v20.19.0' },
          { isDirectory: () => true, name: 'v22.22.0' },
          { isDirectory: () => false, name: 'README.md' },
        ]
      },
    })

    expect(path.split(':')).toEqual(
      expect.arrayContaining([
        '/Users/serva/.nvm/versions/node/v20.19.0/bin',
        '/Users/serva/.nvm/versions/node/v22.22.0/bin',
      ])
    )
  })

  test('keeps Windows PATH unchanged', () => {
    expect(
      resolveDesktopPathEnv({
        env: { Path: 'C:\\Windows\\System32' },
        execSync: () => {
          throw new Error('should not run')
        },
        platform: 'win32',
      })
    ).toBe('C:\\Windows\\System32')
  })

  test('fills proxy variables from the login shell without overwriting existing values', () => {
    const env = {
      HOME: '/Users/alice',
      HTTPS_PROXY: 'http://existing-proxy:7890',
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      SHELL: '/bin/zsh',
    }

    repairDesktopPathEnv(env, {
      execSync: () =>
        Buffer.from(
          shellEnvOutput({
            ALL_PROXY: 'socks5://127.0.0.1:7891',
            HTTPS_PROXY: 'http://shell-proxy:7890',
            PATH: '/usr/bin:/bin',
            http_proxy: 'http://lower-proxy:7890',
          })
        ),
      platform: 'darwin',
    })

    expect(env.HTTPS_PROXY).toBe('http://existing-proxy:7890')
    expect(env.ALL_PROXY).toBe('socks5://127.0.0.1:7891')
    expect(env.http_proxy).toBe('http://lower-proxy:7890')
  })
})
