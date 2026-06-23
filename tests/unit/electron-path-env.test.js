import { describe, expect, test } from 'vitest'

import { resolveDesktopPathEnv } from '../../desktop/electron/path-env.mjs'

describe('desktop Electron PATH repair', () => {
  test('merges login shell PATH with common user CLI locations before runtime starts', () => {
    const path = resolveDesktopPathEnv({
      env: {
        HOME: '/Users/alice',
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        SHELL: '/bin/zsh',
      },
      execSync: () => Buffer.from('/opt/homebrew/bin:/custom/bin:/usr/bin:/bin\n'),
      platform: 'darwin',
    })

    const parts = path.split(':')
    expect(parts).toEqual([
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/Users/alice/.local/bin',
      '/Users/alice/.bun/bin',
      '/Users/alice/.npm-global/bin',
      '/Users/alice/.nvm/current/bin',
      '/custom/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ])
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
