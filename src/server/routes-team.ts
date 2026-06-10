import { type DispatchStatus, isOpenDispatchStatus } from './dispatch-ledger-store.js'
import { BadRequestError, ConflictError } from './http-errors.js'
import { fulfillMobileReplyObligation } from './mobile-reply-obligation.js'
import { readJsonBody, route, sendJson } from './route-helpers.js'
import type {
  CancelTaskBody,
  ReportTaskBody,
  RouteDefinition,
  SendTaskBody,
} from './route-types.js'
import { authenticateCliAgent, requireCommandForRole } from './team-authz.js'
import {
  claimOldestPendingWebRtcVoiceHandoffTurn,
  claimPendingWebRtcVoiceHandoffTurnForId,
  countPendingWebRtcVoiceHandoffTurns,
} from './webrtc-voice-latency.js'

const requireNonEmptyString = (value: unknown, field: string) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestError(`Missing ${field}`)
  }
  return value
}

const getArtifacts = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

type DispatchListStore = {
  listDispatches: (workspaceId: string) => Array<{ status: DispatchStatus; toAgentId: string }>
}

const getOpenDispatchCountForWorker = (
  store: DispatchListStore,
  workspaceId: string,
  workerId: string
) =>
  store
    .listDispatches(workspaceId)
    .filter((dispatch) => dispatch.toAgentId === workerId && isOpenDispatchStatus(dispatch.status))
    .length

const insertTeamMobileReplySystemEvent = (
  store: {
    insertMobileChatMessage: (
      workspaceId: string,
      direction: 'outbound',
      messageType: 'system_event',
      contentJson: string
    ) => unknown
  },
  workspaceId: string,
  payload: Record<string, unknown>
) => {
  store.insertMobileChatMessage(workspaceId, 'outbound', 'system_event', JSON.stringify(payload))
}

export const teamRoutes: RouteDefinition[] = [
  route('POST', '/api/team/send', async ({ request, response, store }) => {
    const body = await readJsonBody<SendTaskBody>(request)
    const projectId = requireNonEmptyString(body.project_id, 'project_id')
    const fromAgentId = requireNonEmptyString(body.from_agent_id, 'from_agent_id')
    const to = requireNonEmptyString(body.to, 'to')
    const text = requireNonEmptyString(body.text, 'text')
    const agent = authenticateCliAgent({
      fromAgentId,
      getAgent: store.getAgent,
      token: body.token,
      validateToken: store.validateAgentToken,
      workspaceId: projectId,
    })
    requireCommandForRole(agent, 'send')
    const dispatch = await store.dispatchTaskByWorkerName(projectId, to, text, {
      fromAgentId,
      hivePort: String(request.socket.localPort ?? ''),
    })

    sendJson(response, 202, { dispatch_id: dispatch.id, ok: true })
  }),
  route('POST', '/api/team/cancel', async ({ request, response, store }) => {
    const body = await readJsonBody<CancelTaskBody>(request)
    const projectId = requireNonEmptyString(body.project_id, 'project_id')
    const fromAgentId = requireNonEmptyString(body.from_agent_id, 'from_agent_id')
    const dispatchId = requireNonEmptyString(body.dispatch_id, 'dispatch_id')
    const reason = requireNonEmptyString(body.reason, 'reason')
    const agent = authenticateCliAgent({
      fromAgentId,
      getAgent: store.getAgent,
      token: body.token,
      validateToken: store.validateAgentToken,
      workspaceId: projectId,
    })
    requireCommandForRole(agent, 'cancel')
    const result = store.cancelTask(projectId, dispatchId, { fromAgentId, reason })
    sendJson(response, 202, {
      dispatch_id: result.dispatch?.id ?? null,
      forward_error: result.forwardError,
      forwarded: result.forwarded,
      ok: true,
    })
  }),
  route('POST', '/api/team/report', async ({ logger, request, response, store }) => {
    const body = await readJsonBody<ReportTaskBody>(request)
    const projectId = requireNonEmptyString(body.project_id, 'project_id')
    const fromAgentId = requireNonEmptyString(body.from_agent_id, 'from_agent_id')
    const resultText = requireNonEmptyString(body.result, 'result')
    const requestDispatchId =
      typeof body.dispatch_id === 'string' && body.dispatch_id.trim().length > 0
        ? body.dispatch_id.trim()
        : undefined
    const agent = authenticateCliAgent({
      fromAgentId,
      getAgent: store.getAgent,
      token: body.token,
      validateToken: store.validateAgentToken,
      workspaceId: projectId,
    })
    requireCommandForRole(agent, 'report')
    const openBefore = getOpenDispatchCountForWorker(store, projectId, fromAgentId)
    if (!requestDispatchId) {
      logger?.warn(
        [
          'team report rejected: missing dispatch_id',
          `worker=${agent.name}`,
          `worker_id=${fromAgentId}`,
          'request_dispatch_id=none',
          'matched_dispatch_id=none',
          `open_dispatch_count_before=${openBefore}`,
          `open_dispatch_count_after=${openBefore}`,
          'fallback=false',
        ].join(' ')
      )
      throw new BadRequestError('Missing dispatch_id for worker report')
    }
    const reportInput = {
      artifacts: getArtifacts(body.artifacts),
      dispatchId: requestDispatchId,
      requireActiveRun: true,
      requireDispatchId: true,
      text: resultText,
    }
    if (typeof body.status === 'string') {
      const result = store.reportTask(projectId, fromAgentId, {
        ...reportInput,
        status: body.status,
      })
      const openAfter = getOpenDispatchCountForWorker(store, projectId, fromAgentId)
      logger?.info(
        [
          'team report accepted',
          `worker=${agent.name}`,
          `worker_id=${fromAgentId}`,
          `request_dispatch_id=${requestDispatchId}`,
          `matched_dispatch_id=${result.dispatch?.id ?? 'none'}`,
          `open_dispatch_count_before=${openBefore}`,
          `open_dispatch_count_after=${openAfter}`,
          'fallback=false',
        ].join(' ')
      )
      sendJson(response, 202, {
        dispatch_id: result.dispatch?.id ?? null,
        forward_error: result.forwardError,
        forwarded: result.forwarded,
        ok: true,
      })
      return
    } else {
      const result = store.reportTask(projectId, fromAgentId, reportInput)
      const openAfter = getOpenDispatchCountForWorker(store, projectId, fromAgentId)
      logger?.info(
        [
          'team report accepted',
          `worker=${agent.name}`,
          `worker_id=${fromAgentId}`,
          `request_dispatch_id=${requestDispatchId}`,
          `matched_dispatch_id=${result.dispatch?.id ?? 'none'}`,
          `open_dispatch_count_before=${openBefore}`,
          `open_dispatch_count_after=${openAfter}`,
          'fallback=false',
        ].join(' ')
      )
      sendJson(response, 202, {
        dispatch_id: result.dispatch?.id ?? null,
        forward_error: result.forwardError,
        forwarded: result.forwarded,
        ok: true,
      })
      return
    }
  }),
  route('POST', '/api/team/status', async ({ request, response, store }) => {
    const body = await readJsonBody<ReportTaskBody>(request)
    const projectId = requireNonEmptyString(body.project_id, 'project_id')
    const fromAgentId = requireNonEmptyString(body.from_agent_id, 'from_agent_id')
    const resultText = requireNonEmptyString(body.result, 'result')
    const agent = authenticateCliAgent({
      fromAgentId,
      getAgent: store.getAgent,
      token: body.token,
      validateToken: store.validateAgentToken,
      workspaceId: projectId,
    })
    requireCommandForRole(agent, 'status')
    const result = store.statusTask(projectId, fromAgentId, {
      artifacts: getArtifacts(body.artifacts),
      requireActiveRun: true,
      text: resultText,
    })
    sendJson(response, 202, {
      dispatch_id: result.dispatch?.id ?? null,
      forward_error: result.forwardError,
      forwarded: result.forwarded,
      ok: true,
    })
    return
  }),
  route(
    'POST',
    '/api/team/mobile-reply',
    async ({ logger, request, response, store, webRtcRuntime }) => {
      const body = await readJsonBody<ReportTaskBody>(request)
      const bodyRecord = body as unknown as Record<string, unknown>
      const projectId = requireNonEmptyString(body.project_id, 'project_id')
      const fromAgentId = requireNonEmptyString(body.from_agent_id, 'from_agent_id')
      const text = requireNonEmptyString(bodyRecord.text, 'text')
      const rawReplyToUserMessageId = bodyRecord.reply_to_user_message_id
      const replyToUserMessageId =
        typeof rawReplyToUserMessageId === 'string' && rawReplyToUserMessageId.trim().length > 0
          ? rawReplyToUserMessageId.trim()
          : undefined
      const rawVoiceLatencyTurnId = bodyRecord.voice_latency_turn_id
      const requestedVoiceLatencyTurnId =
        typeof rawVoiceLatencyTurnId === 'string' && rawVoiceLatencyTurnId.trim().length > 0
          ? rawVoiceLatencyTurnId.trim()
          : undefined
      authenticateCliAgent({
        fromAgentId,
        getAgent: store.getAgent,
        token: body.token,
        validateToken: store.validateAgentToken,
        workspaceId: projectId,
      })
      const activeCallIds = webRtcRuntime?.getActiveWorkspaceCallIds?.(projectId)
      let latencyTurn = null
      if (activeCallIds && activeCallIds.length > 0) {
        const pendingHandoffCount = countPendingWebRtcVoiceHandoffTurns(projectId, {
          callIds: activeCallIds,
        })
        if (requestedVoiceLatencyTurnId) {
          latencyTurn = claimPendingWebRtcVoiceHandoffTurnForId(
            projectId,
            requestedVoiceLatencyTurnId,
            { callIds: activeCallIds }
          )
          if (!latencyTurn) {
            logger?.warn?.(
              `team mobile reply WebRTC handoff correlation rejected: workspace_id=${projectId} from_agent_id=${fromAgentId} voice_latency_turn_id=${requestedVoiceLatencyTurnId} active_webrtc_calls=${activeCallIds.length} pending_handoff_turns=${pendingHandoffCount}`
            )
            insertTeamMobileReplySystemEvent(store, projectId, {
              active_webrtc_calls: activeCallIds,
              event: 'webrtc_handoff_mobile_reply_correlation_rejected',
              from_agent_id: fromAgentId,
              pending_handoff_turns: pendingHandoffCount,
              requested_voice_latency_turn_id: requestedVoiceLatencyTurnId,
            })
            throw new ConflictError(
              'Unable to match voice_latency_turn_id to an active pending WebRTC handoff turn'
            )
          }
        } else {
          if (pendingHandoffCount === 1) {
            latencyTurn = claimOldestPendingWebRtcVoiceHandoffTurn(projectId, {
              callIds: activeCallIds,
            })
          } else if (pendingHandoffCount > 1) {
            logger?.warn?.(
              `team mobile reply WebRTC handoff ambiguous: workspace_id=${projectId} from_agent_id=${fromAgentId} active_webrtc_calls=${activeCallIds.length} pending_handoff_turns=${pendingHandoffCount} voice_latency_turn_id=none`
            )
            insertTeamMobileReplySystemEvent(store, projectId, {
              active_webrtc_calls: activeCallIds,
              event: 'webrtc_handoff_mobile_reply_ambiguous',
              from_agent_id: fromAgentId,
              pending_handoff_turns: pendingHandoffCount,
              voice_latency_turn_id: null,
            })
            throw new ConflictError(
              'Missing voice_latency_turn_id for ambiguous active WebRTC handoff reply'
            )
          }
        }
      }
      store.insertMobileChatMessage(
        projectId,
        'outbound',
        'orch_reply',
        JSON.stringify({
          text,
          ...(latencyTurn ? { voice_latency_turn_id: latencyTurn.turnId } : {}),
          ...(latencyTurn?.intentGeneration !== undefined
            ? { intent_generation: latencyTurn.intentGeneration }
            : {}),
        })
      )
      logger?.info?.(
        `team mobile reply inserted: workspace_id=${projectId} from_agent_id=${fromAgentId} text_len=${text.length} active_webrtc_calls=${activeCallIds?.length ?? 0} voice_latency_turn_id=${latencyTurn?.turnId ?? 'none'}`
      )
      fulfillMobileReplyObligation({
        fromAgentId,
        insertMobileChatMessage: store.insertMobileChatMessage,
        ...(logger ? { logger } : {}),
        ...(replyToUserMessageId ? { replyToUserMessageId } : {}),
        workspaceId: projectId,
      })
      sendJson(response, 200, { ok: true })
    }
  ),
]
