import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, test } from 'vitest'

import { createApprovalLedger } from '../../src/server/feishu-approval-ledger.js'
import { initializeRuntimeDatabase } from '../../src/server/sqlite-schema.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const createTestLedger = () => {
  const db = new Database(':memory:')
  initializeRuntimeDatabase(db)
  const ledger = createApprovalLedger(db)
  return { db, ledger }
}

describe('ApprovalLedger', () => {
  describe('create', () => {
    test('returns approval with UUID approvalId and all input fields', () => {
      const { db, ledger } = createTestLedger()
      const approval = ledger.create({
        action: 'delete files',
        chatId: 'oc_abc',
        messageId: '',
        orchAgentId: 'agent-1',
        risk: 'high',
        target: null,
        workspaceId: 'ws-1',
      })
      expect(approval.approvalId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      )
      expect(typeof approval.createdAt).toBe('number')
      expect(approval.action).toBe('delete files')
      expect(approval.chatId).toBe('oc_abc')
      expect(approval.orchAgentId).toBe('agent-1')
      expect(approval.risk).toBe('high')
      expect(approval.target).toBeNull()
      expect(approval.workspaceId).toBe('ws-1')
      db.close()
    })

    test('generates unique approvalId for each create', () => {
      const { db, ledger } = createTestLedger()
      const ids = new Set<string>()
      for (let i = 0; i < 100; i += 1) {
        const approval = ledger.create({
          action: `action-${i}`,
          chatId: 'oc_x',
          messageId: '',
          orchAgentId: 'agent-1',
          risk: 'medium',
          target: 'worker-a',
          workspaceId: 'ws-1',
        })
        ids.add(approval.approvalId)
      }
      expect(ids.size).toBe(100)
      db.close()
    })
  })

  describe('get', () => {
    test('returns a just-created approval', () => {
      const { db, ledger } = createTestLedger()
      const approval = ledger.create({
        action: 'rm -rf',
        chatId: 'oc_1',
        messageId: '',
        orchAgentId: 'a1',
        risk: 'high',
        target: null,
        workspaceId: 'ws-1',
      })
      const fetched = ledger.get(approval.approvalId)
      expect(fetched).toEqual(approval)
      db.close()
    })

    test('returns null for nonexistent approvalId', () => {
      const { db, ledger } = createTestLedger()
      expect(ledger.get('nonexistent-id')).toBeNull()
      db.close()
    })

    test('persists pending approvals across ledger reloads', () => {
      const dataDir = mkdtempSync(join(tmpdir(), 'hive-approval-ledger-'))
      tempDirs.push(dataDir)
      const dbPath = join(dataDir, 'runtime.sqlite')
      const db1 = new Database(dbPath)
      initializeRuntimeDatabase(db1)
      const ledger1 = createApprovalLedger(db1)
      const approval = ledger1.create({
        action: 'restart service',
        chatId: 'oc_1',
        messageId: 'om_1',
        orchAgentId: 'a1',
        risk: 'high',
        target: null,
        workspaceId: 'ws-1',
      })
      db1.close()

      const db2 = new Database(dbPath)
      initializeRuntimeDatabase(db2)
      const ledger2 = createApprovalLedger(db2)
      expect(ledger2.get(approval.approvalId)).toEqual(approval)
      db2.close()
    })
  })

  describe('resolve', () => {
    test('returns ResolvedApproval with decision, operator, and resolvedAt', () => {
      const { db, ledger } = createTestLedger()
      const approval = ledger.create({
        action: 'deploy',
        chatId: 'oc_1',
        messageId: '',
        orchAgentId: 'a1',
        risk: 'medium',
        target: '关羽',
        workspaceId: 'ws-1',
      })
      const resolved = ledger.resolve(approval.approvalId, 'allow', 'ou_xxx')
      expect(resolved).not.toBeNull()
      expect(resolved?.decision).toBe('allow')
      expect(resolved?.operator).toBe('ou_xxx')
      expect(typeof resolved?.resolvedAt).toBe('number')
      expect(resolved?.approvalId).toBe(approval.approvalId)
      expect(resolved?.action).toBe('deploy')
      db.close()
    })

    test('keeps approval pending until markResolved confirms delivery', () => {
      const { db, ledger } = createTestLedger()
      const approval = ledger.create({
        action: 'reboot',
        chatId: 'oc_1',
        messageId: '',
        orchAgentId: 'a1',
        risk: 'high',
        target: null,
        workspaceId: 'ws-1',
      })
      const resolved = ledger.resolve(approval.approvalId, 'deny', 'ou_yyy')
      expect(resolved).not.toBeNull()
      if (!resolved) throw new Error('expected approval to resolve')
      expect(ledger.get(approval.approvalId)).toEqual(approval)
      ledger.markResolved(resolved)
      expect(ledger.get(approval.approvalId)).toBeNull()
      expect(ledger.resolve(approval.approvalId, 'allow', 'ou_again')).toBeNull()
      db.close()
    })

    test('returns null for nonexistent approvalId', () => {
      const { db, ledger } = createTestLedger()
      expect(ledger.resolve('no-such-id', 'allow', 'ou_x')).toBeNull()
      db.close()
    })

    test('rejects opposite decision after first resolve claims the approval', () => {
      const { db, ledger } = createTestLedger()
      const approval = ledger.create({
        action: 'test',
        chatId: 'oc_1',
        messageId: '',
        orchAgentId: 'a1',
        risk: 'high',
        target: null,
        workspaceId: 'ws-1',
      })
      const first = ledger.resolve(approval.approvalId, 'allow', 'ou_a')
      expect(first).not.toBeNull()
      const second = ledger.resolve(approval.approvalId, 'deny', 'ou_b')
      expect(second).toBeNull()
      if (!first) throw new Error('expected approval to resolve')
      ledger.markResolved(first)
      expect(ledger.resolve(approval.approvalId, 'allow', 'ou_c')).toBeNull()
      db.close()
    })

    test('allows same-decision retry while delivery is in progress', () => {
      const { db, ledger } = createTestLedger()
      const approval = ledger.create({
        action: 'retry',
        chatId: 'oc_1',
        messageId: '',
        orchAgentId: 'a1',
        risk: 'high',
        target: null,
        workspaceId: 'ws-1',
      })
      const first = ledger.resolve(approval.approvalId, 'allow', 'ou_a')
      expect(first).not.toBeNull()
      const retry = ledger.resolve(approval.approvalId, 'allow', 'ou_a')
      expect(retry).toEqual(first)
      if (!retry) throw new Error('expected same-decision retry to resolve')
      ledger.markResolved(retry)
      expect(ledger.resolve(approval.approvalId, 'allow', 'ou_a')).toBeNull()
      db.close()
    })

    test('serial double-click resolves only the first decision', () => {
      const { db, ledger } = createTestLedger()
      const approval = ledger.create({
        action: 'double click',
        chatId: 'oc_1',
        messageId: '',
        orchAgentId: 'a1',
        risk: 'high',
        target: null,
        workspaceId: 'ws-1',
      })
      const attempts = [
        ledger.resolve(approval.approvalId, 'deny', 'ou_first'),
        ledger.resolve(approval.approvalId, 'allow', 'ou_second'),
      ]
      expect(attempts[0]?.decision).toBe('deny')
      expect(attempts[1]).toBeNull()
      if (!attempts[0]) throw new Error('expected first click to claim approval')
      ledger.markResolved(attempts[0])
      expect(ledger.resolve(approval.approvalId, 'allow', 'ou_second')).toBeNull()
      db.close()
    })

    test('persists Feishu card message id updates for retry after restart', () => {
      const dataDir = mkdtempSync(join(tmpdir(), 'hive-approval-message-id-'))
      tempDirs.push(dataDir)
      const dbPath = join(dataDir, 'runtime.sqlite')
      const db1 = new Database(dbPath)
      initializeRuntimeDatabase(db1)
      const ledger1 = createApprovalLedger(db1)
      const approval = ledger1.create({
        action: 'ship release',
        chatId: 'oc_1',
        messageId: '',
        orchAgentId: 'a1',
        risk: 'medium',
        target: null,
        workspaceId: 'ws-1',
      })
      ledger1.setMessageId(approval.approvalId, 'om_card')
      db1.close()

      const db2 = new Database(dbPath)
      initializeRuntimeDatabase(db2)
      const ledger2 = createApprovalLedger(db2)
      expect(ledger2.get(approval.approvalId)?.messageId).toBe('om_card')
      db2.close()
    })
  })

  describe('cleanup', () => {
    test('removes entries older than cutoff and returns removed count', async () => {
      const { db, ledger } = createTestLedger()
      const a1 = ledger.create({
        action: 'old-1',
        chatId: 'oc_1',
        messageId: '',
        orchAgentId: 'a1',
        risk: 'high',
        target: null,
        workspaceId: 'ws-1',
      })
      const a2 = ledger.create({
        action: 'old-2',
        chatId: 'oc_1',
        messageId: '',
        orchAgentId: 'a1',
        risk: 'high',
        target: null,
        workspaceId: 'ws-1',
      })
      await new Promise((resolve) => setTimeout(resolve, 10))
      ledger.create({
        action: 'new',
        chatId: 'oc_1',
        messageId: '',
        orchAgentId: 'a1',
        risk: 'high',
        target: null,
        workspaceId: 'ws-1',
      })
      const removed = ledger.cleanup(5)
      expect(removed).toBe(2)
      expect(ledger.get(a1.approvalId)).toBeNull()
      expect(ledger.get(a2.approvalId)).toBeNull()
      db.close()
    })

    test('does not remove entries newer than cutoff', () => {
      const { db, ledger } = createTestLedger()
      const approval = ledger.create({
        action: 'fresh',
        chatId: 'oc_1',
        messageId: '',
        orchAgentId: 'a1',
        risk: 'high',
        target: null,
        workspaceId: 'ws-1',
      })
      const removed = ledger.cleanup(60000)
      expect(removed).toBe(0)
      expect(ledger.get(approval.approvalId)).toEqual(approval)
      db.close()
    })

    test('cleanup with large value removes only old entries', async () => {
      const { db, ledger } = createTestLedger()
      const oldApproval = ledger.create({
        action: 'old',
        chatId: 'oc_1',
        messageId: '',
        orchAgentId: 'a1',
        risk: 'high',
        target: null,
        workspaceId: 'ws-1',
      })
      await new Promise((resolve) => setTimeout(resolve, 10))
      const newApproval = ledger.create({
        action: 'new',
        chatId: 'oc_1',
        messageId: '',
        orchAgentId: 'a1',
        risk: 'high',
        target: null,
        workspaceId: 'ws-1',
      })
      const removed = ledger.cleanup(5)
      expect(removed).toBe(1)
      expect(ledger.get(oldApproval.approvalId)).toBeNull()
      expect(ledger.get(newApproval.approvalId)).not.toBeNull()
      db.close()
    })
  })
})
