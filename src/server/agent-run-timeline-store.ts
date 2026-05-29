import { randomUUID } from 'node:crypto'

import type { Database } from 'better-sqlite3'

export type AgentRunTimelineDirection = 'after' | 'before' | 'tail'

export interface AgentRunTimelineCursor {
  epoch: number
  seq: number
}

export interface AgentRunTimelineEvent {
  agentId: string | null
  createdAt: number
  epoch: number
  eventType: string
  id: string
  payloadJson: string
  runId: string
  seq: number
  workspaceId: string
}

export interface AppendAgentRunTimelineEventInput {
  agentId?: string | null
  createdAt?: number
  epoch?: number
  eventType: string
  payloadJson: string
  runId: string
  workspaceId: string
}

export interface FetchAgentRunTimelineWindowInput {
  cursor?: AgentRunTimelineCursor
  direction: AgentRunTimelineDirection
  limit?: number
}

export interface AgentRunTimelineWindow {
  endCursor: AgentRunTimelineCursor | null
  events: AgentRunTimelineEvent[]
  gap: boolean
  hasMoreAfter: boolean
  hasMoreBefore: boolean
  reset: boolean
  staleCursor: boolean
  startCursor: AgentRunTimelineCursor | null
}

export interface AgentRunTimelineStore {
  appendEvent: (input: AppendAgentRunTimelineEventInput) => AgentRunTimelineEvent
  fetchWindow: (runId: string, input: FetchAgentRunTimelineWindowInput) => AgentRunTimelineWindow
  listEvents: (runId: string) => AgentRunTimelineEvent[]
}

interface AgentRunTimelineEventRow {
  agent_id: string | null
  created_at: number
  epoch: number
  event_type: string
  id: string
  payload_json: string
  run_id: string
  seq: number
  workspace_id: string
}

interface RunBoundsRow {
  current_epoch: number | null
  max_seq: number | null
  min_seq: number | null
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

const mapRow = (row: AgentRunTimelineEventRow): AgentRunTimelineEvent => ({
  agentId: row.agent_id,
  createdAt: row.created_at,
  epoch: row.epoch,
  eventType: row.event_type,
  id: row.id,
  payloadJson: row.payload_json,
  runId: row.run_id,
  seq: row.seq,
  workspaceId: row.workspace_id,
})

const normalizeLimit = (limit: number | undefined) => {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT)
}

const toCursor = (event: AgentRunTimelineEvent): AgentRunTimelineCursor => ({
  epoch: event.epoch,
  seq: event.seq,
})

const emptyWindow = (
  overrides: Partial<Omit<AgentRunTimelineWindow, 'events'>> = {}
): AgentRunTimelineWindow => ({
  endCursor: null,
  events: [],
  gap: false,
  hasMoreAfter: false,
  hasMoreBefore: false,
  reset: false,
  staleCursor: false,
  startCursor: null,
  ...overrides,
})

export const createAgentRunTimelineStore = (db: Database): AgentRunTimelineStore => {
  const insertEvent = db.prepare(
    `INSERT INTO agent_run_timeline_events (
      id,
      run_id,
      workspace_id,
      agent_id,
      seq,
      epoch,
      event_type,
      payload_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const getNextSeq = db.prepare(
    'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM agent_run_timeline_events WHERE run_id = ?'
  )
  const getCurrentEpoch = db.prepare(
    'SELECT epoch FROM agent_run_timeline_events WHERE run_id = ? ORDER BY seq DESC LIMIT 1'
  )
  const listByRun = db.prepare(
    `SELECT id, run_id, workspace_id, agent_id, seq, epoch, event_type, payload_json, created_at
     FROM agent_run_timeline_events
     WHERE run_id = ?
     ORDER BY seq ASC`
  )
  const getBounds = db.prepare(
    `SELECT
       MIN(seq) AS min_seq,
       MAX(seq) AS max_seq,
       (SELECT epoch
        FROM agent_run_timeline_events AS latest
        WHERE latest.run_id = agent_run_timeline_events.run_id
        ORDER BY latest.seq DESC
        LIMIT 1) AS current_epoch
     FROM agent_run_timeline_events
     WHERE run_id = ?
     GROUP BY run_id`
  )
  const tailQuery = db.prepare(
    `SELECT id, run_id, workspace_id, agent_id, seq, epoch, event_type, payload_json, created_at
     FROM agent_run_timeline_events
     WHERE run_id = ?
     ORDER BY seq DESC
     LIMIT ?`
  )
  const beforeQuery = db.prepare(
    `SELECT id, run_id, workspace_id, agent_id, seq, epoch, event_type, payload_json, created_at
     FROM agent_run_timeline_events
     WHERE run_id = ?
       AND seq < ?
     ORDER BY seq DESC
     LIMIT ?`
  )
  const afterQuery = db.prepare(
    `SELECT id, run_id, workspace_id, agent_id, seq, epoch, event_type, payload_json, created_at
     FROM agent_run_timeline_events
     WHERE run_id = ?
       AND seq > ?
     ORDER BY seq ASC
     LIMIT ?`
  )
  const hasBeforeQuery = db.prepare(
    'SELECT 1 AS present FROM agent_run_timeline_events WHERE run_id = ? AND seq < ? LIMIT 1'
  )
  const hasAfterQuery = db.prepare(
    'SELECT 1 AS present FROM agent_run_timeline_events WHERE run_id = ? AND seq > ? LIMIT 1'
  )

  const appendEvent = db.transaction(
    (input: AppendAgentRunTimelineEventInput): AgentRunTimelineEvent => {
      const nextSeqRow = getNextSeq.get(input.runId) as { next_seq: number }
      const epochRow = getCurrentEpoch.get(input.runId) as { epoch: number } | undefined
      const record: AgentRunTimelineEvent = {
        agentId: input.agentId ?? null,
        createdAt: input.createdAt ?? Date.now(),
        epoch: input.epoch ?? epochRow?.epoch ?? 1,
        eventType: input.eventType,
        id: randomUUID(),
        payloadJson: input.payloadJson,
        runId: input.runId,
        seq: nextSeqRow.next_seq,
        workspaceId: input.workspaceId,
      }
      insertEvent.run(
        record.id,
        record.runId,
        record.workspaceId,
        record.agentId,
        record.seq,
        record.epoch,
        record.eventType,
        record.payloadJson,
        record.createdAt
      )
      return record
    }
  )

  const buildWindow = (
    runId: string,
    input: FetchAgentRunTimelineWindowInput
  ): AgentRunTimelineWindow => {
    const limit = normalizeLimit(input.limit)
    const bounds = getBounds.get(runId) as RunBoundsRow | undefined
    if (!bounds || bounds.min_seq === null || bounds.max_seq === null) {
      return emptyWindow()
    }
    if (
      input.direction !== 'tail' &&
      input.cursor &&
      bounds.current_epoch !== null &&
      input.cursor.epoch !== bounds.current_epoch
    ) {
      return emptyWindow({ reset: true, staleCursor: true })
    }

    const gap =
      input.direction !== 'tail' &&
      input.cursor !== undefined &&
      (input.cursor.seq < bounds.min_seq - 1 || input.cursor.seq > bounds.max_seq + 1)

    let rows: AgentRunTimelineEventRow[]
    if (input.direction === 'tail') {
      rows = (tailQuery.all(runId, limit) as AgentRunTimelineEventRow[]).reverse()
    } else if (input.direction === 'before') {
      if (!input.cursor) throw new Error('cursor is required for before timeline fetches')
      rows = (
        beforeQuery.all(runId, input.cursor.seq, limit) as AgentRunTimelineEventRow[]
      ).reverse()
    } else {
      if (!input.cursor) throw new Error('cursor is required for after timeline fetches')
      rows = afterQuery.all(runId, input.cursor.seq, limit) as AgentRunTimelineEventRow[]
    }

    const events = rows.map(mapRow)
    const first = events.at(0) ?? null
    const last = events.at(-1) ?? null
    return {
      endCursor: last ? toCursor(last) : null,
      events,
      gap,
      hasMoreAfter: last ? hasAfterQuery.get(runId, last.seq) !== undefined : false,
      hasMoreBefore: first ? hasBeforeQuery.get(runId, first.seq) !== undefined : false,
      reset: false,
      staleCursor: false,
      startCursor: first ? toCursor(first) : null,
    }
  }

  return {
    appendEvent,
    fetchWindow: buildWindow,
    listEvents(runId: string): AgentRunTimelineEvent[] {
      return (listByRun.all(runId) as AgentRunTimelineEventRow[]).map(mapRow)
    },
  }
}
