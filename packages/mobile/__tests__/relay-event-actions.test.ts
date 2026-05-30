import { describe, expect, test } from 'vitest'

import type { ChatMessage } from '../src/api/client'
import { resolveRelayEventActions } from '../src/api/relay-event-actions'

const chatMessage = (id: string): ChatMessage => ({
  content_json: JSON.stringify({ text: 'hi' }),
  created_at: 1,
  direction: 'inbound',
  id,
  message_type: 'orch_reply',
})

describe('resolveRelayEventActions', () => {
  test('dashboard_update for current workspace → bump syncRevision + refresh dashboard, no merge', () => {
    const actions = resolveRelayEventActions(
      { kind: 'dashboard_update', payload: { workspace_id: 'ws-1' } },
      'ws-1'
    )
    expect(actions.bumpSyncRevision).toBe(true)
    expect(actions.refreshDashboardWorkspaceId).toBe('ws-1')
    expect(actions.mergeChatMessage).toBeNull()
  })

  test('chat_message for current workspace → merge only, never bump (cockpit tabs not forced to refetch on every chat line)', () => {
    const message = chatMessage('m1')
    const actions = resolveRelayEventActions(
      { kind: 'chat_message', payload: { message, workspace_id: 'ws-1' } },
      'ws-1'
    )
    expect(actions.mergeChatMessage).toEqual(message)
    expect(actions.bumpSyncRevision).toBe(false)
    expect(actions.refreshDashboardWorkspaceId).toBeNull()
  })

  test('dashboard_update for a different workspace → no-op (no bump, no refresh)', () => {
    const actions = resolveRelayEventActions(
      { kind: 'dashboard_update', payload: { workspace_id: 'ws-other' } },
      'ws-1'
    )
    expect(actions).toEqual({
      bumpSyncRevision: false,
      mergeChatMessage: null,
      refreshDashboardWorkspaceId: null,
    })
  })

  test('chat_message for a different workspace → no merge', () => {
    const actions = resolveRelayEventActions(
      { kind: 'chat_message', payload: { message: chatMessage('m2'), workspace_id: 'ws-other' } },
      'ws-1'
    )
    expect(actions.mergeChatMessage).toBeNull()
    expect(actions.bumpSyncRevision).toBe(false)
  })

  test('unknown event kind → no-op', () => {
    const actions = resolveRelayEventActions({ kind: 'something_else', payload: {} }, 'ws-1')
    expect(actions).toEqual({
      bumpSyncRevision: false,
      mergeChatMessage: null,
      refreshDashboardWorkspaceId: null,
    })
  })
})
