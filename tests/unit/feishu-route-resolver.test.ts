import { describe, expect, test } from 'vitest'

import { resolveRoute } from '../../src/server/feishu-route-resolver.js'

describe('resolveRoute', () => {
  test('returns no_binding when chat_id has no binding', () => {
    const result = resolveRoute({
      bindingsStore: { findByChatId: () => null },
      chatId: 'oc_missing',
      workspaceStore: { getWorkspaceSnapshot: () => ({}) },
    })
    expect(result).toEqual({ reason: 'no_binding' })
  })

  test('returns no_binding when binding exists but enabled is false', () => {
    const result = resolveRoute({
      bindingsStore: { findByChatId: () => ({ enabled: false, workspaceId: 'ws-1' }) },
      chatId: 'oc_x',
      workspaceStore: { getWorkspaceSnapshot: () => ({}) },
    })
    expect(result).toEqual({ reason: 'no_binding' })
  })

  test('returns workspace_missing when workspaceStore.getWorkspaceSnapshot throws', () => {
    const result = resolveRoute({
      bindingsStore: { findByChatId: () => ({ enabled: true, workspaceId: 'ws-gone' }) },
      chatId: 'oc_x',
      workspaceStore: {
        getWorkspaceSnapshot: () => {
          throw new Error('Workspace not found: ws-gone')
        },
      },
    })
    expect(result).toEqual({ reason: 'workspace_missing' })
  })

  test('does not leak workspace error message to caller', () => {
    const result = resolveRoute({
      bindingsStore: { findByChatId: () => ({ enabled: true, workspaceId: 'ws-1' }) },
      chatId: 'oc_x',
      workspaceStore: {
        getWorkspaceSnapshot: () => {
          throw new Error('sensitive internal details')
        },
      },
    })
    if (!('reason' in result)) throw new Error('expected reason in result')
    expect(result.reason).toBe('workspace_missing')
    expect(JSON.stringify(result)).not.toContain('sensitive')
  })

  test('returns orchestratorAgentId and workspaceId for valid binding + workspace', () => {
    const result = resolveRoute({
      bindingsStore: { findByChatId: () => ({ enabled: true, workspaceId: 'ws-abc' }) },
      chatId: 'oc_bound',
      workspaceStore: { getWorkspaceSnapshot: () => ({ summary: { id: 'ws-abc' } }) },
    })
    if ('reason' in result) throw new Error('expected route, got reason')
    expect(result.workspaceId).toBe('ws-abc')
    expect(result.orchestratorAgentId).toBe('ws-abc:orchestrator')
  })

  test('orchestratorAgentId has no trailing whitespace', () => {
    const result = resolveRoute({
      bindingsStore: {
        findByChatId: () => ({ enabled: true, workspaceId: '  ws-1  ' }),
      },
      chatId: 'oc_x',
      workspaceStore: { getWorkspaceSnapshot: () => ({}) },
    })
    if ('reason' in result) throw new Error('expected route')
    expect(result.orchestratorAgentId).toBe('  ws-1  :orchestrator')
    expect(result.orchestratorAgentId).not.toMatch(/\s$/)
  })
})
