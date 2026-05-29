import type {
  AgentRunTimelineCursor,
  AgentRunTimelineDirection,
  AgentRunTimelineEvent,
} from './agent-run-timeline-store.js'
import { getRequiredParam, route, sendJson } from './route-helpers.js'
import type { RouteDefinition } from './route-types.js'
import { requireUiTokenFromRequest } from './ui-auth-helpers.js'

const DIRECTIONS = new Set<AgentRunTimelineDirection>(['after', 'before', 'tail'])
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

const readLimit = (value: string | null) => {
  if (value === null) return { limit: DEFAULT_LIMIT } as const
  if (!/^[1-9][0-9]*$/.test(value)) {
    return { error: `limit must be between 1 and ${MAX_LIMIT}` } as const
  }
  const limit = Number(value)
  if (!Number.isSafeInteger(limit) || limit > MAX_LIMIT) {
    return { error: `limit must be between 1 and ${MAX_LIMIT}` } as const
  }
  return { limit } as const
}

const readPositiveInt = (value: string | null) => {
  if (value === null || !/^[1-9][0-9]*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

const serializeEvent = (event: AgentRunTimelineEvent) => ({
  agent_id: event.agentId,
  created_at: event.createdAt,
  epoch: event.epoch,
  event_type: event.eventType,
  id: event.id,
  payload_json: event.payloadJson,
  run_id: event.runId,
  seq: event.seq,
  workspace_id: event.workspaceId,
})

const serializeCursor = (cursor: AgentRunTimelineCursor | null) =>
  cursor ? { epoch: cursor.epoch, seq: cursor.seq } : null

export const runTimelineRoutes: RouteDefinition[] = [
  route('GET', '/api/ui/runs/:runId/timeline', ({ params, request, response, store }) => {
    const runId = getRequiredParam(response, params, 'runId', 'Run id is required')
    if (!runId) return

    requireUiTokenFromRequest(request, store.validateUiToken)
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const directionParam = url.searchParams.get('direction') ?? 'tail'
    if (!DIRECTIONS.has(directionParam as AgentRunTimelineDirection)) {
      sendJson(response, 400, { error: 'direction must be tail, before, or after' })
      return
    }
    const direction = directionParam as AgentRunTimelineDirection
    const limitResult = readLimit(url.searchParams.get('limit'))
    if ('error' in limitResult) {
      sendJson(response, 400, { error: limitResult.error })
      return
    }

    let cursor: AgentRunTimelineCursor | undefined
    if (direction !== 'tail') {
      const seq = readPositiveInt(url.searchParams.get('seq'))
      const epoch = readPositiveInt(url.searchParams.get('epoch'))
      if (seq === null || epoch === null) {
        sendJson(response, 400, {
          error: 'seq and epoch are required for before/after timeline fetches',
        })
        return
      }
      cursor = { epoch, seq }
    }

    const window = store.fetchAgentRunTimelineWindow(runId, {
      ...(cursor ? { cursor } : {}),
      direction,
      limit: limitResult.limit,
    })
    sendJson(response, 200, {
      direction,
      end_cursor: serializeCursor(window.endCursor),
      events: window.events.map(serializeEvent),
      gap: window.gap,
      has_more_after: window.hasMoreAfter,
      has_more_before: window.hasMoreBefore,
      reset: window.reset,
      run_id: runId,
      stale_cursor: window.staleCursor,
      start_cursor: serializeCursor(window.startCursor),
    })
  }),
]
