import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { resolveHiveBinDir } from '../../src/server/agent-run-bootstrap.js'

describe('resolveHiveBinDir', () => {
  it('uses the unpacked Electron bin directory when runtime code is inside app.asar', () => {
    const moduleUrl = pathToFileURL(
      '/Applications/HippoTeam.app/Contents/Resources/app.asar/dist/src/server/agent-run-bootstrap.js'
    ).href

    expect(
      resolveHiveBinDir({
        moduleUrl,
        pathExists: (path) =>
          path === '/Applications/HippoTeam.app/Contents/Resources/app.asar.unpacked/dist/bin',
      })
    ).toBe('/Applications/HippoTeam.app/Contents/Resources/app.asar.unpacked/dist/bin')
  })

  it('keeps the normal build bin directory outside Electron asar packaging', () => {
    const moduleUrl = pathToFileURL(
      '/Users/alice/hive-serva/dist/src/server/agent-run-bootstrap.js'
    ).href

    expect(resolveHiveBinDir({ moduleUrl, pathExists: () => false })).toBe(
      '/Users/alice/hive-serva/dist/bin'
    )
  })
})
