import { describe, expect, test, vi } from 'vitest'

vi.mock('react-native', () => {
  const component = (name: string) => name
  return {
    ActivityIndicator: component('ActivityIndicator'),
    Pressable: component('Pressable'),
    StyleSheet: { create: <T>(styles: T) => styles },
    Text: component('Text'),
    View: component('View'),
  }
})

vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }))

const runtime = {
  clearFailedOutbox: vi.fn(),
  connectionMode: 'relay',
  outboxFailedCount: 2,
  outboxPendingCount: 0,
  outboxSendingCount: 0,
  reconnecting: false,
  retryOutbox: vi.fn(),
  state: 'connected',
}

vi.mock('../src/api/mobile-runtime-context', () => ({
  useMobileRuntime: () => runtime,
}))

vi.mock('../src/i18n', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}))

import { ConnectionModeBanner } from '../src/components/ConnectionModeBanner'

const walk = (node: unknown, visit: (node: Record<string, unknown>) => void) => {
  if (!node || typeof node !== 'object') return
  const current = node as Record<string, unknown>
  visit(current)
  const props = current.props as { children?: unknown } | undefined
  const children = props?.children
  if (Array.isArray(children)) {
    for (const child of children) walk(child, visit)
    return
  }
  walk(children, visit)
}

describe('ConnectionModeBanner outbox actions', () => {
  test('renders retry and clear actions for failed outbox items and calls clear callback', () => {
    runtime.clearFailedOutbox.mockClear()
    runtime.retryOutbox.mockClear()

    const tree = ConnectionModeBanner()
    const texts: string[] = []
    const pressables: Array<{ onPress?: () => void }> = []
    walk(tree, (node) => {
      if (node.type === 'Text') {
        const props = node.props as { children?: unknown }
        if (typeof props.children === 'string') texts.push(props.children)
      }
      if (node.type === 'Pressable') {
        pressables.push((node.props ?? {}) as { onPress?: () => void })
      }
    })

    expect(texts).toContain('outbox.failed:{"count":2}')
    expect(texts).toContain('outbox.retry')
    expect(texts).toContain('outbox.clear')

    const clearButton = pressables.at(-1)
    expect(clearButton?.onPress).toBeTypeOf('function')
    clearButton?.onPress?.()
    expect(runtime.clearFailedOutbox).toHaveBeenCalledOnce()
    expect(runtime.retryOutbox).not.toHaveBeenCalled()
  })
})
