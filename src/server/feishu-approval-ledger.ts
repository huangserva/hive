import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'

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
  markResolved(resolved: ResolvedApproval): void
  resolve(
    approvalId: string,
    decision: FeishuApprovalDecision,
    operator: string
  ): ResolvedApproval | null
  get(approvalId: string): PendingApproval | null
  setMessageId(approvalId: string, messageId: string): void
  cleanup(olderThanMs: number): number
}

type ApprovalRow = {
  action: string
  approval_id: string
  chat_id: string
  created_at: number
  decision: FeishuApprovalDecision | null
  message_id: string
  orch_agent_id: string
  operator: string | null
  resolved_at: number | null
  risk: FeishuApprovalRisk
  status: 'pending' | 'resolving' | 'resolved'
  target: string | null
  workspace_id: string
}

const mapPendingApproval = (row: ApprovalRow): PendingApproval => ({
  action: row.action,
  approvalId: row.approval_id,
  chatId: row.chat_id,
  createdAt: row.created_at,
  messageId: row.message_id,
  orchAgentId: row.orch_agent_id,
  risk: row.risk,
  target: row.target,
  workspaceId: row.workspace_id,
})

const mapResolvedApproval = (row: ApprovalRow): ResolvedApproval | null => {
  if (!row.decision || !row.operator || row.resolved_at === null) return null
  return {
    ...mapPendingApproval(row),
    decision: row.decision,
    operator: row.operator,
    resolvedAt: row.resolved_at,
  }
}

export const createApprovalLedger = (db: Database): ApprovalLedger => {
  const selectUnfinishedApproval = db.prepare(
    `SELECT
      approval_id,
      workspace_id,
      orch_agent_id,
      chat_id,
      message_id,
      action,
      risk,
      target,
      status,
      decision,
      operator,
      created_at,
      resolved_at
     FROM feishu_approvals
     WHERE approval_id = ? AND status IN ('pending', 'resolving')`
  )

  return {
    create: (input) => {
      const approval: PendingApproval = {
        ...input,
        approvalId: randomUUID(),
        createdAt: Date.now(),
      }
      db.prepare(
        `INSERT INTO feishu_approvals (
          approval_id,
          workspace_id,
          orch_agent_id,
          chat_id,
          message_id,
          action,
          risk,
          target,
          status,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
      ).run(
        approval.approvalId,
        approval.workspaceId,
        approval.orchAgentId,
        approval.chatId,
        approval.messageId,
        approval.action,
        approval.risk,
        approval.target,
        approval.createdAt
      )
      return approval
    },
    markResolved: (resolved) => {
      db.prepare(
        `UPDATE feishu_approvals
         SET status = 'resolved',
             decision = ?,
             operator = ?,
             resolved_at = ?
         WHERE approval_id = ? AND status = 'resolving' AND decision = ?`
      ).run(
        resolved.decision,
        resolved.operator,
        resolved.resolvedAt,
        resolved.approvalId,
        resolved.decision
      )
    },
    resolve: (approvalId, decision, operator) => {
      const resolvedAt = Date.now()
      const claim = db
        .prepare(
          `UPDATE feishu_approvals
           SET status = 'resolving',
               decision = ?,
               operator = ?,
               resolved_at = ?
           WHERE approval_id = ? AND status = 'pending'`
        )
        .run(decision, operator, resolvedAt, approvalId)

      const row = selectUnfinishedApproval.get(approvalId) as ApprovalRow | undefined
      if (!row) return null
      if (claim.changes === 0 && (row.status !== 'resolving' || row.decision !== decision)) {
        return null
      }

      return mapResolvedApproval(row)
    },
    get: (approvalId) => {
      const row = selectUnfinishedApproval.get(approvalId) as ApprovalRow | undefined
      return row ? mapPendingApproval(row) : null
    },
    setMessageId: (approvalId, messageId) => {
      db.prepare(
        `UPDATE feishu_approvals
         SET message_id = ?
         WHERE approval_id = ? AND status = 'pending'`
      ).run(messageId, approvalId)
    },
    cleanup: (olderThanMs) => {
      const cutoff = Date.now() - olderThanMs
      const result = db
        .prepare("DELETE FROM feishu_approvals WHERE status != 'resolved' AND created_at < ?")
        .run(cutoff)
      return result.changes
    },
  }
}
