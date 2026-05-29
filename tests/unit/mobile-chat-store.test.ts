import Database from 'better-sqlite3'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { createMobileChatStore } from '../../src/server/mobile-chat-store.js'

describe('mobile chat store', () => {
  let db: Database

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
  })

  const createStore = () => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE mobile_chat_messages (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        message_type TEXT NOT NULL,
        content_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_mobile_chat_workspace_time
        ON mobile_chat_messages(workspace_id, created_at);
    `)
    return createMobileChatStore(db)
  }

  test('keeps same-millisecond inserts page-able by since without dropping messages', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    const store = createStore()

    const first = store.insertChatMessage('ws-1', 'inbound', 'user_text', '{"text":"first"}')
    const second = store.insertChatMessage('ws-1', 'outbound', 'orch_reply', '{"text":"second"}')
    const third = store.insertChatMessage('ws-1', 'outbound', 'system_event', '{"text":"third"}')

    expect([first.created_at, second.created_at, third.created_at]).toEqual([
      1700000000000, 1700000000001, 1700000000002,
    ])
    expect(store.listChatMessages('ws-1', first.created_at, 10)).toEqual([second, third])
  })

  test('lists the latest page in ascending order when no since cursor is provided', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    const store = createStore()

    const messages = Array.from({ length: 8 }, (_, index) =>
      store.insertChatMessage('ws-1', 'outbound', 'orch_reply', `{"text":"message-${index + 1}"}`)
    )

    expect(store.listChatMessages('ws-1', undefined, 5)).toEqual(messages.slice(3))
  })

  test('lists messages after the since cursor in ascending order', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000)
    const store = createStore()

    const messages = Array.from({ length: 8 }, (_, index) =>
      store.insertChatMessage('ws-1', 'outbound', 'orch_reply', `{"text":"message-${index + 1}"}`)
    )

    expect(store.listChatMessages('ws-1', messages[2].created_at, 5)).toEqual(messages.slice(3))
  })
})
