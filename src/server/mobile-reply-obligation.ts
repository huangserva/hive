import type {
  MobileChatDirection,
  MobileChatMessage,
  MobileChatMessageType,
} from './mobile-chat-store.js'
import type { PtyOutputBus } from './pty-output-bus.js'

type TimerHandle = ReturnType<typeof setTimeout>

interface MobileReplyObligation {
  activeRunId: string
  callId?: string
  createdAt: number
  fromAgentId: string
  plainOutputWarned: boolean
  source: 'mobile'
  timeout: TimerHandle
  turnId?: string
  unsubscribe: () => void
  userMessageId: string
  workspaceId: string
}

export interface MobileReplyObligationLogger {
  info?: (message: string) => void
  warn?: (message: string) => void
}

interface StartMobileReplyObligationInput {
  activeRunId: string
  callId?: string
  fromAgentId: string
  insertMobileChatMessage: (
    workspaceId: string,
    direction: MobileChatDirection,
    messageType: MobileChatMessageType,
    contentJson: string
  ) => MobileChatMessage
  logger?: MobileReplyObligationLogger
  outputBus: PtyOutputBus
  timeoutMs?: number
  turnId?: string
  userMessageId: string
  workspaceId: string
}

interface RecordMobileReplyObligationUnavailableInput {
  activeRunId: string
  callId?: string
  fromAgentId: string
  insertMobileChatMessage: StartMobileReplyObligationInput['insertMobileChatMessage']
  logger?: MobileReplyObligationLogger
  reason: 'missing_output_bus'
  turnId?: string
  userMessageId: string
  workspaceId: string
}

const DEFAULT_MOBILE_REPLY_WATCHDOG_MS = 30_000
const obligationsByUserMessageId = new Map<string, MobileReplyObligation>()
const obligationIdsByWorkspaceId = new Map<string, string[]>()

const resolveWatchdogMs = (input?: number) => {
  if (input !== undefined && Number.isFinite(input) && input > 0) return Math.trunc(input)
  const envValue = Number.parseInt(process.env.HIVE_MOBILE_REPLY_WATCHDOG_MS ?? '', 10)
  if (Number.isFinite(envValue) && envValue > 0) return envValue
  return DEFAULT_MOBILE_REPLY_WATCHDOG_MS
}

const formatOptional = (value: string | undefined) => value ?? 'none'

const buildEventPayload = (obligation: MobileReplyObligation, event: string, now = Date.now()) => ({
  active_run_id: obligation.activeRunId,
  call_id: obligation.callId ?? null,
  elapsed_ms: Math.max(0, now - obligation.createdAt),
  event,
  from_agent_id: obligation.fromAgentId,
  source: obligation.source,
  turn_id: obligation.turnId ?? null,
  user_message_id: obligation.userMessageId,
})

const buildUnavailableEventPayload = (
  input: RecordMobileReplyObligationUnavailableInput,
  now = Date.now()
) => ({
  active_run_id: input.activeRunId,
  call_id: input.callId ?? null,
  elapsed_ms: 0,
  event: 'mobile_reply_obligation_unavailable',
  from_agent_id: input.fromAgentId,
  reason: input.reason,
  source: 'mobile',
  turn_id: input.turnId ?? null,
  user_message_id: input.userMessageId,
  workspace_id: input.workspaceId,
  created_at: now,
})

const insertSystemEvent = (
  obligation: MobileReplyObligation,
  insertMobileChatMessage: StartMobileReplyObligationInput['insertMobileChatMessage'],
  event: string
) => {
  insertMobileChatMessage(
    obligation.workspaceId,
    'outbound',
    'system_event',
    JSON.stringify(buildEventPayload(obligation, event))
  )
}

const removeObligation = (userMessageId: string) => {
  const obligation = obligationsByUserMessageId.get(userMessageId)
  if (!obligation) return null
  clearTimeout(obligation.timeout)
  obligation.unsubscribe()
  obligationsByUserMessageId.delete(userMessageId)
  const ids = obligationIdsByWorkspaceId.get(obligation.workspaceId)
  if (ids) {
    const next = ids.filter((id) => id !== userMessageId)
    if (next.length > 0) obligationIdsByWorkspaceId.set(obligation.workspaceId, next)
    else obligationIdsByWorkspaceId.delete(obligation.workspaceId)
  }
  return obligation
}

const logFields = (obligation: MobileReplyObligation, elapsedMs: number) =>
  `source=${obligation.source} user_message_id=${obligation.userMessageId} call_id=${formatOptional(
    obligation.callId
  )} turn_id=${formatOptional(obligation.turnId)} from_agent_id=${
    obligation.fromAgentId
  } elapsed_ms=${elapsedMs} active_run_id=${obligation.activeRunId}`

export const startMobileReplyObligation = ({
  activeRunId,
  callId,
  fromAgentId,
  insertMobileChatMessage,
  logger,
  outputBus,
  timeoutMs,
  turnId,
  userMessageId,
  workspaceId,
}: StartMobileReplyObligationInput) => {
  removeObligation(userMessageId)
  const createdAt = Date.now()
  const resolvedTimeoutMs = resolveWatchdogMs(timeoutMs)
  const obligation: MobileReplyObligation = {
    activeRunId,
    createdAt,
    fromAgentId,
    plainOutputWarned: false,
    source: 'mobile',
    timeout: setTimeout(() => {
      const current = obligationsByUserMessageId.get(userMessageId)
      if (!current) return
      const elapsedMs = Date.now() - current.createdAt
      logger?.warn?.(`mobile reply obligation stalled: ${logFields(current, elapsedMs)}`)
      insertSystemEvent(current, insertMobileChatMessage, 'mobile_reply_obligation_stalled')
      removeObligation(userMessageId)
    }, resolvedTimeoutMs),
    unsubscribe: () => {},
    userMessageId,
    workspaceId,
    ...(callId ? { callId } : {}),
    ...(turnId ? { turnId } : {}),
  }
  const timeoutWithUnref = obligation.timeout as TimerHandle & { unref?: () => void }
  timeoutWithUnref.unref?.()

  obligation.unsubscribe = outputBus.subscribe(activeRunId, (chunk) => {
    const current = obligationsByUserMessageId.get(userMessageId)
    if (!current || current.plainOutputWarned || chunk.trim().length === 0) return
    current.plainOutputWarned = true
    const elapsedMs = Date.now() - current.createdAt
    logger?.warn?.(
      `mobile reply obligation stdout without mobile-reply: ${logFields(current, elapsedMs)}`
    )
    insertSystemEvent(
      current,
      insertMobileChatMessage,
      'mobile_reply_plain_output_without_mobile_reply'
    )
  })
  obligationsByUserMessageId.set(userMessageId, obligation)
  const ids = obligationIdsByWorkspaceId.get(workspaceId) ?? []
  ids.push(userMessageId)
  obligationIdsByWorkspaceId.set(workspaceId, ids)
  logger?.info?.(
    `mobile reply obligation opened: ${logFields(obligation, 0)} timeout_ms=${resolvedTimeoutMs}`
  )
}

export const recordMobileReplyObligationUnavailable = (
  input: RecordMobileReplyObligationUnavailableInput
) => {
  input.logger?.warn?.(
    `mobile reply obligation unavailable: source=mobile user_message_id=${
      input.userMessageId
    } call_id=${formatOptional(input.callId)} turn_id=${formatOptional(
      input.turnId
    )} from_agent_id=${input.fromAgentId} active_run_id=${input.activeRunId} reason=${input.reason}`
  )
  input.insertMobileChatMessage(
    input.workspaceId,
    'outbound',
    'system_event',
    JSON.stringify(buildUnavailableEventPayload(input))
  )
}

export const fulfillMobileReplyObligation = ({
  fromAgentId,
  insertMobileChatMessage,
  logger,
  replyToUserMessageId,
  workspaceId,
}: {
  fromAgentId: string
  insertMobileChatMessage?: StartMobileReplyObligationInput['insertMobileChatMessage']
  logger?: MobileReplyObligationLogger
  replyToUserMessageId?: string
  workspaceId: string
}) => {
  const ids = obligationIdsByWorkspaceId.get(workspaceId) ?? []
  const matchingIds = ids.filter(
    (id) => obligationsByUserMessageId.get(id)?.fromAgentId === fromAgentId
  )
  const matchId = replyToUserMessageId
    ? matchingIds.find((id) => id === replyToUserMessageId)
    : matchingIds.length === 1
      ? matchingIds[0]
      : undefined
  if (!replyToUserMessageId && matchingIds.length > 1) {
    const first = obligationsByUserMessageId.get(matchingIds[0] ?? '')
    logger?.warn?.(
      `mobile reply obligation ambiguous: source=mobile workspace_id=${workspaceId} from_agent_id=${fromAgentId} pending_count=${matchingIds.length} reply_to_user_message_id=missing`
    )
    if (first && insertMobileChatMessage) {
      insertSystemEvent(first, insertMobileChatMessage, 'mobile_reply_obligation_ambiguous')
    }
    return null
  }
  if (!matchId) return null
  const obligation = removeObligation(matchId)
  if (!obligation) return null
  const elapsedMs = Date.now() - obligation.createdAt
  logger?.info?.(`mobile reply obligation fulfilled: ${logFields(obligation, elapsedMs)}`)
  return obligation
}

export const resetMobileReplyObligationsForTests = () => {
  for (const id of [...obligationsByUserMessageId.keys()]) removeObligation(id)
}
