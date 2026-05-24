import { describe, expect, test, vi } from 'vitest'

import { createAgentLaunchCache } from '../../src/server/agent-launch-cache.js'

const makeConfig = (overrides: Record<string, unknown> = {}) => ({
  args: [],
  command: '/bin/bash',
  commandPresetId: null,
  interactiveCommand: null,
  presetAugmentationDisabled: false,
  resumeArgsTemplate: null,
  sessionIdCapture: null,
  thinkingLevel: null,
  ...overrides,
})

describe('agent-launch-cache negative cache', () => {
  test('lookup miss caches negative; second lookup does not call store.listLaunchConfigs', () => {
    const listLaunchConfigs = vi.fn().mockReturnValue([])
    const store = { deleteLaunchConfig: vi.fn(), listLaunchConfigs, saveLaunchConfig: vi.fn() }
    const cache = createAgentLaunchCache(store)

    expect(() => cache.get('ws-1', 'agent-missing')).toThrow('Agent launch config not found')
    expect(listLaunchConfigs).toHaveBeenCalledTimes(2)

    expect(() => cache.get('ws-1', 'agent-missing')).toThrow('Agent launch config not found')
    expect(listLaunchConfigs).toHaveBeenCalledTimes(2)
  })

  test('save clears negative cache entry for that agent', () => {
    const listLaunchConfigs = vi.fn().mockReturnValue([])
    const saveLaunchConfig = vi.fn()
    const store = { deleteLaunchConfig: vi.fn(), listLaunchConfigs, saveLaunchConfig }
    const cache = createAgentLaunchCache(store)

    expect(cache.peek('ws-1', 'agent-x')).toBeUndefined()

    cache.save('ws-1', 'agent-x', makeConfig({ command: 'node' }))
    const result = cache.peek('ws-1', 'agent-x')
    expect(result).toBeDefined()
    expect(result?.command).toBe('node')
  })

  test('remove sets negative cache marker', () => {
    const config = makeConfig()
    const listLaunchConfigs = vi
      .fn()
      .mockReturnValue([{ agentId: 'agent-x', config, workspaceId: 'ws-1' }])
    const deleteLaunchConfig = vi.fn()
    const store = { deleteLaunchConfig, listLaunchConfigs, saveLaunchConfig: vi.fn() }
    const cache = createAgentLaunchCache(store)

    expect(cache.peek('ws-1', 'agent-x')).toEqual(config)

    cache.remove('ws-1', 'agent-x')
    expect(deleteLaunchConfig).toHaveBeenCalledWith('ws-1', 'agent-x')
    expect(cache.peek('ws-1', 'agent-x')).toBeUndefined()
  })

  test('get throws after remove due to negative cache', () => {
    const config = makeConfig()
    const listLaunchConfigs = vi
      .fn()
      .mockReturnValue([{ agentId: 'agent-x', config, workspaceId: 'ws-1' }])
    const store = { deleteLaunchConfig: vi.fn(), listLaunchConfigs, saveLaunchConfig: vi.fn() }
    const cache = createAgentLaunchCache(store)

    cache.remove('ws-1', 'agent-x')
    expect(() => cache.get('ws-1', 'agent-x')).toThrow('Agent launch config not found')
  })

  test('getWorkspaceId returns workspace after save', () => {
    const store = {
      deleteLaunchConfig: vi.fn(),
      listLaunchConfigs: vi.fn().mockReturnValue([]),
      saveLaunchConfig: vi.fn(),
    }
    const cache = createAgentLaunchCache(store)

    cache.save('ws-2', 'agent-y', makeConfig())
    expect(cache.getWorkspaceId('agent-y')).toBe('ws-2')
  })

  test('getWorkspaceId returns undefined for unknown agent', () => {
    const store = {
      deleteLaunchConfig: vi.fn(),
      listLaunchConfigs: vi.fn().mockReturnValue([]),
      saveLaunchConfig: vi.fn(),
    }
    const cache = createAgentLaunchCache(store)

    expect(cache.getWorkspaceId('nonexistent')).toBeUndefined()
  })
})
