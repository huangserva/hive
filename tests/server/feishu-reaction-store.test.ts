import { describe, expect, test } from 'vitest'

import { FeishuReactionStore } from '../../src/server/feishu-reaction-store.js'

describe('FeishuReactionStore', () => {
  test('stores and takes a reaction id once', () => {
    const store = new FeishuReactionStore()

    store.set('om_1', 'rx_1')

    expect(store.take('om_1')).toBe('rx_1')
    expect(store.take('om_1')).toBeUndefined()
  })

  test('tracks the latest message per chat without clearing reactions', () => {
    const store = new FeishuReactionStore()

    store.set('om_1', 'rx_1')
    store.setLatestForChat('oc_1', 'om_1')
    store.setLatestForChat('oc_1', 'om_2')

    expect(store.getLatestForChat('oc_1')).toBe('om_2')
    expect(store.take('om_1')).toBe('rx_1')
  })
})
