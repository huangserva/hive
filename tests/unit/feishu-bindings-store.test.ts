import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { createFeishuBindingsStore } from '../../src/server/feishu-bindings-store.js'
import { BadRequestError, ConflictError } from '../../src/server/http-errors.js'
import { openRuntimeDatabase } from '../../src/server/runtime-database.js'

describe('createFeishuBindingsStore', () => {
  let db: ReturnType<typeof openRuntimeDatabase>
  let store: ReturnType<typeof createFeishuBindingsStore>

  beforeEach(() => {
    db = openRuntimeDatabase()
    store = createFeishuBindingsStore(db)
  })

  afterEach(() => {
    db.close()
  })

  test('bind() returns a binding with generated id and createdAt', () => {
    const before = Date.now() - 1
    const binding = store.bind({ workspaceId: 'ws-1', chatId: 'oc_x' })
    expect(binding.id).toMatch(/[0-9a-f-]{36}/)
    expect(binding.workspaceId).toBe('ws-1')
    expect(binding.chatId).toBe('oc_x')
    expect(binding.chatName).toBeNull()
    expect(binding.enabled).toBe(true)
    expect(binding.createdAt).toBeGreaterThanOrEqual(before)
  })

  test('findByChatId() returns the bound row', () => {
    store.bind({ workspaceId: 'ws-1', chatId: 'oc_x', chatName: 'Team A' })
    const found = store.findByChatId('oc_x')
    expect(found).not.toBeNull()
    expect(found?.workspaceId).toBe('ws-1')
    expect(found?.chatName).toBe('Team A')
  })

  test('findByChatId() returns null when chat_id is unknown', () => {
    expect(store.findByChatId('oc_nonexistent')).toBeNull()
  })

  test('bind() rejects duplicate chat_id with ConflictError', () => {
    store.bind({ workspaceId: 'ws-1', chatId: 'oc_x' })
    expect(() => store.bind({ workspaceId: 'ws-2', chatId: 'oc_x' })).toThrow(ConflictError)
  })

  test('bind() trims chat_id whitespace before storing', () => {
    store.bind({ workspaceId: 'ws-1', chatId: '  oc_x  ' })
    expect(store.findByChatId('oc_x')?.chatId).toBe('oc_x')
  })

  test('bind() rejects empty chat_id', () => {
    expect(() => store.bind({ workspaceId: 'ws-1', chatId: '   ' })).toThrow(BadRequestError)
  })

  test('unbind() removes the row and returns true', () => {
    store.bind({ workspaceId: 'ws-1', chatId: 'oc_x' })
    expect(store.unbind('oc_x')).toBe(true)
    expect(store.findByChatId('oc_x')).toBeNull()
  })

  test('unbind() returns false for unknown chat_id', () => {
    expect(store.unbind('oc_missing')).toBe(false)
  })

  test('unbindByWorkspace() deletes every binding for that workspace', () => {
    store.bind({ workspaceId: 'ws-1', chatId: 'oc_a' })
    store.bind({ workspaceId: 'ws-1', chatId: 'oc_b' })
    store.bind({ workspaceId: 'ws-2', chatId: 'oc_c' })
    store.unbindByWorkspace('ws-1')
    expect(store.listByWorkspace('ws-1')).toEqual([])
    expect(store.listByWorkspace('ws-2')).toHaveLength(1)
  })

  test('listByWorkspace() returns bindings ordered by createdAt ASC', () => {
    const first = store.bind({ workspaceId: 'ws-1', chatId: 'oc_a' })
    const second = store.bind({ workspaceId: 'ws-1', chatId: 'oc_b' })
    const all = store.listByWorkspace('ws-1')
    expect(all.map((b) => b.id)).toEqual([first.id, second.id])
  })

  test('bind() stores unicode chat_id without corruption', () => {
    const chatId = 'oc_群名_测试'
    const binding = store.bind({ workspaceId: 'ws-1', chatId })
    expect(binding.chatId).toBe(chatId)
    expect(store.findByChatId(chatId)?.chatId).toBe(chatId)
  })

  test('bind() converts empty string chatName to null', () => {
    const binding = store.bind({ workspaceId: 'ws-1', chatId: 'oc_x', chatName: '' })
    expect(binding.chatName).toBeNull()
    expect(store.findByChatId('oc_x')?.chatName).toBeNull()
  })

  test('bind() converts whitespace-only chatName to null', () => {
    const binding = store.bind({ workspaceId: 'ws-1', chatId: 'oc_x', chatName: '   ' })
    expect(binding.chatName).toBeNull()
  })

  test('bind() trims non-empty chatName', () => {
    const binding = store.bind({ workspaceId: 'ws-1', chatId: 'oc_x', chatName: '  Team A  ' })
    expect(binding.chatName).toBe('Team A')
  })

  test('bind() rejects chat_id exceeding 256 characters', () => {
    const longChatId = `oc_${'x'.repeat(254)}`
    expect(() => store.bind({ workspaceId: 'ws-1', chatId: longChatId })).toThrow(BadRequestError)
  })

  test('bind() accepts chat_id at exactly 256 characters', () => {
    const maxChatId = 'o'.repeat(256)
    const binding = store.bind({ workspaceId: 'ws-1', chatId: maxChatId })
    expect(binding.chatId).toBe(maxChatId)
    expect(binding.chatId.length).toBe(256)
  })

  test('bind() rejects chat_name exceeding 200 characters', () => {
    const longName = 'n'.repeat(201)
    expect(() => store.bind({ workspaceId: 'ws-1', chatId: 'oc_x', chatName: longName })).toThrow(
      BadRequestError
    )
  })

  test('findByChatId() trims whitespace on lookup', () => {
    store.bind({ workspaceId: 'ws-1', chatId: 'oc_x' })
    expect(store.findByChatId('  oc_x  ')?.chatId).toBe('oc_x')
  })

  test('unbind() trims whitespace on chat_id', () => {
    store.bind({ workspaceId: 'ws-1', chatId: 'oc_x' })
    expect(store.unbind('  oc_x  ')).toBe(true)
    expect(store.findByChatId('oc_x')).toBeNull()
  })

  test('listAll() returns bindings from all workspaces', () => {
    store.bind({ workspaceId: 'ws-1', chatId: 'oc_a', chatName: 'A' })
    store.bind({ workspaceId: 'ws-2', chatId: 'oc_b', chatName: 'B' })
    const all = store.listAll()
    expect(all).toHaveLength(2)
    const workspaceIds = new Set(all.map((b) => b.workspaceId))
    expect(workspaceIds).toEqual(new Set(['ws-1', 'ws-2']))
  })

  test('duplicate chat_id error message references the existing workspace', () => {
    store.bind({ workspaceId: 'ws-1', chatId: 'oc_x' })
    try {
      store.bind({ workspaceId: 'ws-2', chatId: 'oc_x' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError)
      expect((error as ConflictError).message).toContain('ws-1')
      expect((error as ConflictError).message).toContain('oc_x')
    }
  })

  test('bind() with same workspace and chat_id updates chat_name', () => {
    const first = store.bind({ workspaceId: 'ws-1', chatId: 'oc_x', chatName: 'Old Name' })
    const second = store.bind({ workspaceId: 'ws-1', chatId: 'oc_x', chatName: 'New Name' })
    expect(second.id).toBe(first.id)
    expect(second.chatName).toBe('New Name')
    expect(store.listByWorkspace('ws-1')).toHaveLength(1)
  })
})
