import { describe, expect, test } from 'vitest'

import { resolveDesktopPathEnv } from '../../desktop/electron/path-env.mjs'

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
        return Buffer.from('/opt/homebrew/bin:/custom/bin:/usr/bin:/bin\n')
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
      execSync: () => Buffer.from('/usr/bin:/bin:/usr/sbin:/sbin\n'),
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
})
