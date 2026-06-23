import { randomUUID } from 'node:crypto'

import type { Database } from 'better-sqlite3'

export type DispatchStatus =
  | 'queued'
  | 'submitted'
  | 'running'
  | 'report_overdue'
  | 'completed'
  | 'reported'
  | 'cancelled'
  | 'orphaned'

// M43 Phase 1: review_status 旁挂维度，独立于 status 8 态。
// NULL = 该 dispatch 不在 accept-gate 范围（gate 关 / 非 coder / report-only / 存量数据）
export type ReviewStatus = 'pending' | 'accepted' | 'rejected' | 'waived'

export interface AcceptVerdict {
  /** accepted | rejected | waived 之一；与 review_status 同步。 */
  verdict: ReviewStatus
  /** reviewer 或 orchestrator agent_id。 */
  byAgentId: string
  /** 时间戳。 */
  at: number
  /** verdict 原因；team accept 强制要求。 */
  reason: string
  /** 被 accept/reject/waive 时 coder report 携带的证据快照。 */
  evidence?: string[] | undefined
  /** 当 verdict 来自 reviewer dispatch 时，引回 reviewer dispatch.id。 */
  reviewsDispatchId?: string
}

export interface DispatchRecord {
  artifacts: string[]
  createdAt: number
  deliveredAt: number | null
  evidence?: string[]
  fromAgentId: string | null
  id: string
  reportedAt: number | null
  reportText: string | null
  sequence: number | null
  status: DispatchStatus
  submittedAt: number | null
  text: string
  toAgentId: string
  workspaceId: string
  /** M43 旁挂维度；NULL 表示不在 accept-gate 范围（走旧路径） */
  reviewStatus: ReviewStatus | null
  /** M43 reviewer dispatch 指向被审 coder dispatch.id */
  reviewsDispatchId: string | null
  /** M43 accept verdict JSON，落在被审 coder dispatch 上 */
  acceptVerdict: AcceptVerdict | null
}

interface DispatchRow {
  artifacts: string | null
  created_at: number
  delivered_at: number | null
  evidence_json: string | null
  from_agent_id: string | null
  id: string
  reported_at: number | null
  report_text: string | null
  sequence: number
  status: DispatchStatus
  submitted_at: number | null
  text: string
  to_agent_id: string
  workspace_id: string
  review_status: string | null
  reviews_dispatch_id: string | null
  accept_verdict: string | null
}

interface CreateDispatchInput {
  fromAgentId?: string
  text: string
  toAgentId: string
  workspaceId: string
}

interface ReportDispatchInput {
  artifacts: string[]
  dispatchId?: string
  evidence?: string[]
  reportText: string
  toAgentId: string
  workspaceId: string
}

interface CancelDispatchInput {
  dispatchId: string
  reason: string
  workspaceId: string
}

const OPEN_DISPATCH_STATUSES = ['queued', 'submitted', 'running', 'report_overdue'] as const
const openDispatchStatusSql = OPEN_DISPATCH_STATUSES.map((status) => `'${status}'`).join(', ')

export const isOpenDispatchStatus = (status: DispatchStatus): boolean =>
  OPEN_DISPATCH_STATUSES.includes(status as (typeof OPEN_DISPATCH_STATUSES)[number])

export const isCompletedDispatchStatus = (status: DispatchStatus): boolean =>
  status === 'completed' || status === 'reported'

export const isActiveDispatchStatus = (status: DispatchStatus): boolean =>
  status === 'submitted' || status === 'running' || status === 'report_overdue'

export interface ListDispatchesOptions {
  limit?: number
  offset?: number
  status?: DispatchStatus
}

const parseArtifacts = (value: string | null) => {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((artifact): artifact is string => typeof artifact === 'string')
      : []
  } catch {
    return []
  }
}

const parseEvidence = (value: string | null) => {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

const VALID_REVIEW_STATUSES = new Set<ReviewStatus>(['pending', 'accepted', 'rejected', 'waived'])

const parseReviewStatus = (value: string | null): ReviewStatus | null => {
  if (value === null) return null
  return VALID_REVIEW_STATUSES.has(value as ReviewStatus) ? (value as ReviewStatus) : null
}

const parseAcceptVerdict = (value: string | null): AcceptVerdict | null => {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<AcceptVerdict> & Record<string, unknown>
    if (
      typeof parsed.verdict !== 'string' ||
      !VALID_REVIEW_STATUSES.has(parsed.verdict as ReviewStatus) ||
      typeof parsed.byAgentId !== 'string' ||
      typeof parsed.at !== 'number' ||
      typeof parsed.reason !== 'string'
    ) {
      return null
    }
    const out: AcceptVerdict = {
      verdict: parsed.verdict as ReviewStatus,
      byAgentId: parsed.byAgentId,
      at: parsed.at,
      reason: parsed.reason,
    }
    if (Array.isArray(parsed.evidence)) {
      const evidence = parsed.evidence.filter((item): item is string => typeof item === 'string')
      if (evidence.length > 0) out.evidence = evidence
    }
    if (typeof parsed.reviewsDispatchId === 'string' && parsed.reviewsDispatchId) {
      out.reviewsDispatchId = parsed.reviewsDispatchId
    }
    return out
  } catch {
    return null
  }
}

const toRecord = (row: DispatchRow): DispatchRecord => ({
  artifacts: parseArtifacts(row.artifacts),
  createdAt: row.created_at,
  deliveredAt: row.delivered_at,
  evidence: parseEvidence(row.evidence_json),
  fromAgentId: row.from_agent_id,
  id: row.id,
  reportedAt: row.reported_at,
  reportText: row.report_text,
  sequence: row.sequence,
  status: row.status,
  submittedAt: row.submitted_at,
  text: row.text,
  toAgentId: row.to_agent_id,
  workspaceId: row.workspace_id,
  reviewStatus: parseReviewStatus(row.review_status),
  reviewsDispatchId: row.reviews_dispatch_id,
  acceptVerdict: parseAcceptVerdict(row.accept_verdict),
})

export const createDispatchLedgerStore = (db: Database) => {
  const createDispatch = (input: CreateDispatchInput) => {
    const record: DispatchRecord = {
      artifacts: [],
      createdAt: Date.now(),
      deliveredAt: null,
      evidence: [],
      fromAgentId: input.fromAgentId ?? null,
      id: randomUUID(),
      reportedAt: null,
      reportText: null,
      sequence: null,
      status: 'queued',
      submittedAt: null,
      text: input.text,
      toAgentId: input.toAgentId,
      workspaceId: input.workspaceId,
      reviewStatus: null,
      reviewsDispatchId: null,
      acceptVerdict: null,
    }

    const insertResult = db
      .prepare(
        `INSERT INTO dispatches (
        id,
        workspace_id,
        from_agent_id,
        to_agent_id,
        text,
        status,
        created_at,
        delivered_at,
        submitted_at,
        reported_at,
        report_text,
        artifacts,
        evidence_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.workspaceId,
        record.fromAgentId,
        record.toAgentId,
        record.text,
        record.status,
        record.createdAt,
        record.deliveredAt,
        record.submittedAt,
        record.reportedAt,
        record.reportText,
        JSON.stringify(record.artifacts),
        JSON.stringify(record.evidence)
      )

    return {
      ...record,
      sequence: Number(insertResult.lastInsertRowid),
    }
  }

  const deleteDispatch = (dispatchId: string) => {
    db.prepare('DELETE FROM dispatches WHERE id = ?').run(dispatchId)
  }

  const markSubmitted = (dispatchId: string) => {
    const submittedAt = Date.now()
    db.prepare(
      `UPDATE dispatches
       SET status = ?, submitted_at = ?
       WHERE id = ?`
    ).run('running', submittedAt, dispatchId)
  }

  const markReportOverdue = (dispatchId: string) => {
    const row = db
      .prepare(
        `SELECT *
         FROM dispatches
         WHERE id = ?
           AND status IN ('submitted', 'running', 'report_overdue')
         LIMIT 1`
      )
      .get(dispatchId) as DispatchRow | undefined

    if (!row) return undefined
    const dispatch = toRecord(row)
    if (dispatch.status === 'report_overdue') return dispatch
    db.prepare(
      `UPDATE dispatches
       SET status = ?
       WHERE id = ?`
    ).run('report_overdue', dispatchId)
    return { ...dispatch, status: 'report_overdue' as const }
  }

  const findOpenDispatch = (workspaceId: string, toAgentId: string, dispatchId?: string) => {
    if (dispatchId) {
      const row = db
        .prepare(
          `SELECT *
           FROM dispatches
           WHERE id = ?
             AND workspace_id = ?
             AND to_agent_id = ?
             AND status IN (${openDispatchStatusSql})
           LIMIT 1`
        )
        .get(dispatchId, workspaceId, toAgentId) as DispatchRow | undefined

      return row ? toRecord(row) : undefined
    }

    const row = db
      .prepare(
        `SELECT *
         FROM dispatches
         WHERE workspace_id = ?
           AND to_agent_id = ?
           AND status IN (${openDispatchStatusSql})
         ORDER BY sequence ASC
         LIMIT 1`
      )
      .get(workspaceId, toAgentId) as DispatchRow | undefined

    return row ? toRecord(row) : undefined
  }

  const findOpenDispatchById = (workspaceId: string, dispatchId: string) => {
    const row = db
      .prepare(
        `SELECT *
         FROM dispatches
         WHERE id = ?
           AND workspace_id = ?
           AND status IN (${openDispatchStatusSql})
         LIMIT 1`
      )
      .get(dispatchId, workspaceId) as DispatchRow | undefined

    return row ? toRecord(row) : undefined
  }

  const findLatestClosedDispatchForWorker = (workspaceId: string, toAgentId: string) => {
    const row = db
      .prepare(
        `SELECT *
         FROM dispatches
         WHERE workspace_id = ?
           AND to_agent_id = ?
           AND status NOT IN (${openDispatchStatusSql})
         ORDER BY COALESCE(reported_at, submitted_at, created_at) DESC, sequence DESC
         LIMIT 1`
      )
      .get(workspaceId, toAgentId) as DispatchRow | undefined

    return row ? toRecord(row) : undefined
  }

  const listOpenDispatchesForWorker = (workspaceId: string, workerId: string) =>
    (
      db
        .prepare(
          `SELECT *
           FROM dispatches
           WHERE workspace_id = ?
             AND to_agent_id = ?
             AND status IN (${openDispatchStatusSql})
           ORDER BY sequence ASC`
        )
        .all(workspaceId, workerId) as DispatchRow[]
    ).map(toRecord)

  const listOpenDispatchesForWorkspace = (workspaceId: string) =>
    (
      db
        .prepare(
          `SELECT *
           FROM dispatches
           WHERE workspace_id = ?
             AND status IN (${openDispatchStatusSql})
           ORDER BY sequence ASC`
        )
        .all(workspaceId) as DispatchRow[]
    ).map(toRecord)

  const markReportedByWorker = (input: ReportDispatchInput) => {
    const dispatch = findOpenDispatch(input.workspaceId, input.toAgentId, input.dispatchId)
    if (!dispatch) {
      return undefined
    }

    const reportedAt = Date.now()
    db.prepare(
      `UPDATE dispatches
       SET status = ?,
           reported_at = ?,
           report_text = ?,
           artifacts = ?,
           evidence_json = ?
       WHERE id = ?`
    ).run(
      'completed',
      reportedAt,
      input.reportText,
      JSON.stringify(input.artifacts),
      JSON.stringify(input.evidence ?? []),
      dispatch.id
    )

    return {
      ...dispatch,
      artifacts: input.artifacts,
      evidence: input.evidence ?? [],
      reportedAt,
      reportText: input.reportText,
      status: 'completed' as const,
    }
  }

  const markCancelled = (input: CancelDispatchInput) => {
    const dispatch = findOpenDispatchById(input.workspaceId, input.dispatchId)
    if (!dispatch) {
      return undefined
    }

    const cancelledAt = Date.now()
    db.prepare(
      `UPDATE dispatches
       SET status = ?,
           reported_at = ?,
           report_text = ?
       WHERE id = ?`
    ).run('cancelled', cancelledAt, input.reason, dispatch.id)

    return {
      ...dispatch,
      reportedAt: cancelledAt,
      reportText: input.reason,
      status: 'cancelled' as const,
    }
  }

  const markOrphaned = (input: CancelDispatchInput) => {
    const dispatch = findOpenDispatchById(input.workspaceId, input.dispatchId)
    if (!dispatch) {
      return undefined
    }

    const orphanedAt = Date.now()
    db.prepare(
      `UPDATE dispatches
       SET status = ?,
           reported_at = ?,
           report_text = ?
       WHERE id = ?`
    ).run('orphaned', orphanedAt, input.reason, dispatch.id)

    return {
      ...dispatch,
      reportedAt: orphanedAt,
      reportText: input.reason,
      status: 'orphaned' as const,
    }
  }

  const listWorkspaceDispatches = (workspaceId: string, options: ListDispatchesOptions = {}) => {
    const offset = options.offset ?? 0
    const limit = options.limit ?? 100

    if (options.status) {
      return (
        db
          .prepare(
            `SELECT *
             FROM dispatches
             WHERE workspace_id = ?
               AND status = ?
             ORDER BY sequence ASC
             LIMIT ? OFFSET ?`
          )
          .all(workspaceId, options.status, limit, offset) as DispatchRow[]
      ).map(toRecord)
    }

    return (
      db
        .prepare(
          `SELECT *
           FROM dispatches
           WHERE workspace_id = ?
           ORDER BY sequence ASC
           LIMIT ? OFFSET ?`
        )
        .all(workspaceId, limit, offset) as DispatchRow[]
    ).map(toRecord)
  }

  const listOpenDispatchKinds = () => {
    return db
      .prepare(
        `SELECT workspace_id, to_agent_id AS worker_id, 'send' AS type
           FROM dispatches
           WHERE status IN (${openDispatchStatusSql})
           ORDER BY sequence ASC`
      )
      .all() as Array<{ type: 'send'; worker_id: string; workspace_id: string }>
  }

  const deleteWorkspaceDispatches = (workspaceId: string) => {
    db.prepare('DELETE FROM dispatches WHERE workspace_id = ?').run(workspaceId)
  }

  const deleteWorkerDispatches = (workspaceId: string, workerId: string) => {
    db.prepare('DELETE FROM dispatches WHERE workspace_id = ? AND to_agent_id = ?').run(
      workspaceId,
      workerId
    )
  }

  // M43 — 任意状态的 dispatch 都可读（accept gate 路径要找 reported coder dispatch，不能用
  // findOpenDispatchById：那个只查 open 4 态）。
  const findDispatchById = (
    workspaceId: string,
    dispatchId: string
  ): DispatchRecord | undefined => {
    const row = db
      .prepare(
        `SELECT *
         FROM dispatches
         WHERE id = ?
           AND workspace_id = ?
         LIMIT 1`
      )
      .get(dispatchId, workspaceId) as DispatchRow | undefined
    return row ? toRecord(row) : undefined
  }

  const findDispatchesByIdPrefix = (workspaceId: string, idPrefix: string): DispatchRecord[] => {
    const prefix = idPrefix.trim().toLowerCase()
    if (!/^[0-9a-f-]{8,36}$/iu.test(prefix)) return []
    if (prefix.length === 36) {
      const found = findDispatchById(workspaceId, prefix)
      return found ? [found] : []
    }
    return (
      db
        .prepare(
          `SELECT *
           FROM dispatches
           WHERE workspace_id = ?
             AND id LIKE ?
           ORDER BY sequence ASC`
        )
        .all(workspaceId, `${prefix}%`) as DispatchRow[]
    ).map(toRecord)
  }

  // M43 — 写 review_status 单字段（不动 status 8 态）。
  // 同时支持回退到 NULL（worker re-report 路径清回 pending 也走这里）。
  const setReviewStatus = (dispatchId: string, status: ReviewStatus | null): void => {
    db.prepare('UPDATE dispatches SET review_status = ? WHERE id = ?').run(status, dispatchId)
  }

  // M43 — 写 accept verdict（在被审 coder dispatch 上）+ 同步 review_status。
  // verdict.verdict 必须与 review_status 同语义；调用方保证。
  const applyAcceptVerdict = (dispatchId: string, verdict: AcceptVerdict): void => {
    db.prepare(
      `UPDATE dispatches
       SET review_status = ?,
           accept_verdict = ?
       WHERE id = ?`
    ).run(verdict.verdict, JSON.stringify(verdict), dispatchId)
  }

  // M43 — 仅在 reviewer dispatch 上写 reviews_dispatch_id（精确链接被审 coder dispatch）。
  const linkReviewsDispatchId = (reviewerDispatchId: string, coderDispatchId: string): void => {
    db.prepare('UPDATE dispatches SET reviews_dispatch_id = ? WHERE id = ?').run(
      coderDispatchId,
      reviewerDispatchId
    )
  }

  // M43 — 清空 review_status / accept_verdict（worker re-report 路径，让上一轮 rejected 回 pending）。
  const clearReviewStatus = (dispatchId: string): void => {
    db.prepare(
      `UPDATE dispatches
       SET review_status = NULL,
           accept_verdict = NULL
       WHERE id = ?`
    ).run(dispatchId)
  }

  return {
    applyAcceptVerdict,
    clearReviewStatus,
    createDispatch,
    deleteDispatch,
    deleteWorkerDispatches,
    deleteWorkspaceDispatches,
    findDispatchById,
    findDispatchesByIdPrefix,
    findLatestClosedDispatchForWorker,
    findOpenDispatch,
    findOpenDispatchById,
    linkReviewsDispatchId,
    listOpenDispatchesForWorker,
    listOpenDispatchesForWorkspace,
    listOpenDispatchKinds,
    listWorkspaceDispatches,
    markCancelled,
    markOrphaned,
    markReportOverdue,
    markReportedByWorker,
    markSubmitted,
    setReviewStatus,
  }
}
