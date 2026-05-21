// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'

import { Topbar } from '../../web/src/layout/Topbar.js'

afterEach(() => {
  cleanup()
})

describe('Topbar version update hint', () => {
  test('does not show upstream update badge when a newer version is available', () => {
    render(
      <Topbar
        hideActions
        onToggleTaskGraph={() => {}}
        taskGraphOpen={false}
        version="0.6.0-alpha.3"
        versionInfo={{
          currentVersion: '0.6.0-alpha.3',
          installHint: 'npm update -g @tt-a1i/hive',
          latestVersion: '0.6.0-alpha.4',
          packageName: '@tt-a1i/hive',
          releaseUrl: 'https://www.npmjs.com/package/@tt-a1i/hive/v/0.6.0-alpha.4',
          updateAvailable: true,
        }}
      />
    )

    expect(screen.queryByTestId('topbar-update-badge')).not.toBeInTheDocument()
    expect(screen.queryByText('v0.6.0-alpha.3 → v0.6.0-alpha.4')).not.toBeInTheDocument()
    expect(screen.queryByText('npm update -g @tt-a1i/hive')).not.toBeInTheDocument()
  })
})
