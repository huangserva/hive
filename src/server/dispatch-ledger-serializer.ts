import type { DispatchRecord } from './dispatch-ledger-store.js'

export const serializeDispatchRecord = (record: DispatchRecord) => ({
  artifacts: record.artifacts,
  created_at: record.createdAt,
  delivered_at: record.deliveredAt,
  evidence: record.evidence ?? [],
  from_agent_id: record.fromAgentId,
  id: record.id,
  reported_at: record.reportedAt,
  report_text: record.reportText,
  state: record.status,
  submitted_at: record.submittedAt,
  text: record.text,
  to_agent_id: record.toAgentId,
  workspace_id: record.workspaceId,
  review_status: record.reviewStatus,
  reviews_dispatch_id: record.reviewsDispatchId,
  accept_verdict: record.acceptVerdict,
})
