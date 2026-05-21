import { describe, expect, test } from 'vitest'

import { createApprovalLedger } from '../../src/server/feishu-approval-ledger.js'

describe('ApprovalLedger', () => {
  describe('create', () => {
    test('returns approval with UUID approvalId and all input fields', () => {
      const ledger = createApprovalLedger()
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
    })

    test('generates unique approvalId for each create', () => {
      const ledger = createApprovalLedger()
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
    })
  })

  describe('get', () => {
    test('returns a just-created approval', () => {
      const ledger = createApprovalLedger()
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
    })

    test('returns null for nonexistent approvalId', () => {
      const ledger = createApprovalLedger()
      expect(ledger.get('nonexistent-id')).toBeNull()
    })
  })

  describe('resolve', () => {
    test('returns ResolvedApproval with decision, operator, and resolvedAt', () => {
      const ledger = createApprovalLedger()
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
    })

    test('removes approval from pending after resolve', () => {
      const ledger = createApprovalLedger()
      const approval = ledger.create({
        action: 'reboot',
        chatId: 'oc_1',
        messageId: '',
        orchAgentId: 'a1',
        risk: 'high',
        target: null,
        workspaceId: 'ws-1',
      })
      ledger.resolve(approval.approvalId, 'deny', 'ou_yyy')
      expect(ledger.get(approval.approvalId)).toBeNull()
    })

    test('returns null for nonexistent approvalId', () => {
      const ledger = createApprovalLedger()
      expect(ledger.resolve('no-such-id', 'allow', 'ou_x')).toBeNull()
    })

    test('returns null on second resolve of same approval', () => {
      const ledger = createApprovalLedger()
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
    })
  })

  describe('cleanup', () => {
    test('removes entries older than cutoff and returns removed count', async () => {
      const ledger = createApprovalLedger()
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
    })

    test('does not remove entries newer than cutoff', () => {
      const ledger = createApprovalLedger()
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
    })

    test('cleanup with large value removes only old entries', async () => {
      const ledger = createApprovalLedger()
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
    })
  })
})
