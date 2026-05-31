import { describe, expect, test } from 'vitest'

import { getConnectionModeBannerSnapshot } from '../src/components/connection-mode-banner-state'

describe('connection mode banner snapshot', () => {
  test('shows a disconnected reconnecting state instead of the last transport mode', () => {
    expect(
      getConnectionModeBannerSnapshot({
        connectionMode: 'relay',
        reconnecting: true,
        state: 'connected',
      })
    ).toEqual({
      displayMode: 'disconnected',
      showConnecting: true,
    })
  })

  test('shows the live transport mode only when connected and stable', () => {
    expect(
      getConnectionModeBannerSnapshot({
        connectionMode: 'lan',
        reconnecting: false,
        state: 'connected',
      })
    ).toEqual({
      displayMode: 'lan',
      showConnecting: false,
    })
  })
})
