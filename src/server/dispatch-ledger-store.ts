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

export interface DispatchRecord {
  artifacts: string[]
  createdAt: number
  deliveredAt: number | null
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
}

interface DispatchRow {
  artifacts: string | null
  created_at: number
  delivered_at: number | null
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

const toRecord = (row: DispatchRow): DispatchRecord => ({
  artifacts: parseArtifacts(row.artifacts),
  createdAt: row.created_at,
  deliveredAt: row.delivered_at,
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
})

export const createDispatchLedgerStore = (db: Database) => {
  const createDispatch = (input: CreateDispatchInput) => {
    const record: DispatchRecord = {
      artifacts: [],
      createdAt: Date.now(),
      deliveredAt: null,
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
    }

    db.prepare(
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
        artifacts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
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
      JSON.stringify(record.artifacts)
    )

    return record
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
           artifacts = ?
       WHERE id = ?`
    ).run('completed', reportedAt, input.reportText, JSON.stringify(input.artifacts), dispatch.id)

    return {
      ...dispatch,
      artifacts: input.artifacts,
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

  return {
    createDispatch,
    deleteDispatch,
    deleteWorkerDispatches,
    deleteWorkspaceDispatches,
    findOpenDispatch,
    findOpenDispatchById,
    listOpenDispatchesForWorker,
    listOpenDispatchesForWorkspace,
    listOpenDispatchKinds,
    listWorkspaceDispatches,
    markCancelled,
    markOrphaned,
    markReportOverdue,
    markReportedByWorker,
    markSubmitted,
  }
}
