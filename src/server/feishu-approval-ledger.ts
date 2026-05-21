import { randomUUID } from 'node:crypto'

export type FeishuApprovalRisk = 'high' | 'medium'
export type FeishuApprovalDecision = 'allow' | 'deny'

export interface PendingApproval {
  approvalId: string
  orchAgentId: string
  workspaceId: string
  chatId: string
  messageId: string
  action: string
  risk: FeishuApprovalRisk
  target: string | null
  createdAt: number
}

export interface ResolvedApproval extends PendingApproval {
  decision: FeishuApprovalDecision
  operator: string
  resolvedAt: number
}

export interface ApprovalLedger {
  create(input: Omit<PendingApproval, 'approvalId' | 'createdAt'>): PendingApproval
  resolve(
    approvalId: string,
    decision: FeishuApprovalDecision,
    operator: string
  ): ResolvedApproval | null
  get(approvalId: string): PendingApproval | null
  cleanup(olderThanMs: number): number
}

export const createApprovalLedger = (): ApprovalLedger => {
  const pending = new Map<string, PendingApproval>()

  return {
    create: (input) => {
      const approval: PendingApproval = {
        ...input,
        approvalId: randomUUID(),
        createdAt: Date.now(),
      }
      pending.set(approval.approvalId, approval)
      return approval
    },
    resolve: (approvalId, decision, operator) => {
      const approval = pending.get(approvalId)
      if (!approval) return null
      pending.delete(approvalId)
      return {
        ...approval,
        decision,
        operator,
        resolvedAt: Date.now(),
      }
    },
    get: (approvalId) => pending.get(approvalId) ?? null,
    cleanup: (olderThanMs) => {
      const cutoff = Date.now() - olderThanMs
      let removed = 0
      for (const [approvalId, approval] of pending.entries()) {
        if (approval.createdAt >= cutoff) continue
        pending.delete(approvalId)
        removed += 1
      }
      return removed
    },
  }
}
