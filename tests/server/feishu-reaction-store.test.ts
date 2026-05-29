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

  test('evicts oldest reactions when the configured limit is exceeded', () => {
    const store = new FeishuReactionStore({ maxReactions: 2 })

    store.set('om_1', 'rx_1')
    store.set('om_2', 'rx_2')
    store.set('om_3', 'rx_3')

    expect(store.take('om_1')).toBeUndefined()
    expect(store.take('om_2')).toBe('rx_2')
    expect(store.take('om_3')).toBe('rx_3')
  })

  test('expires stale reactions before they can grow without bound', () => {
    const store = new FeishuReactionStore({ now: () => 10_000, ttlMs: 1_000 })

    store.set('om_old', 'rx_old')

    expect(store.take('om_old', 11_001)).toBeUndefined()
  })
})
