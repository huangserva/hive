type WebRtcVoiceLatencyTurnInput = {
  callId: string
  now?: number
  segment: number
  speechStartAt?: number
  workspaceId: string
}

export type WebRtcVoiceLatencyTurn = {
  branch?: 'drop' | 'escalate' | 'handled' | 'incomplete'
  callId: string
  decisionAt?: number
  escalated?: boolean
  fastReplyEnterAt?: number
  finalAt: number
  firstDownlinkFrameAt?: number
  forwardPm?: boolean
  gatekeeperAt?: number
  glmRequestAt?: number
  glmResponseAt?: number
  intentVerdictAt?: number
  segment: number
  speechStartAt?: number
  textLen?: number
  ttsEndAt?: number
  ttsStartAt?: number
  turnId: string
  workspaceId: string
}

const turnsById = new Map<string, WebRtcVoiceLatencyTurn>()
const pendingTurnsByWorkspaceId = new Map<string, string[]>()
const turnIdByDownlinkMessageId = new Map<string, string>()

const nowMs = () => Date.now()

const duration = (start?: number, end?: number) =>
  typeof start === 'number' && typeof end === 'number' ? Math.max(0, end - start) : null

const formatDuration = (value: number | null) => (value === null ? 'na' : String(value))

const removePendingTurnId = (turnId: string) => {
  for (const [workspaceId, pending] of pendingTurnsByWorkspaceId) {
    const nextPending = pending.filter((pendingTurnId) => pendingTurnId !== turnId)
    if (nextPending.length === pending.length) continue
    if (nextPending.length === 0) {
      pendingTurnsByWorkspaceId.delete(workspaceId)
    } else {
      pendingTurnsByWorkspaceId.set(workspaceId, nextPending)
    }
  }
}

const removeMessageBindingsForTurn = (turnId: string) => {
  for (const [messageId, boundTurnId] of turnIdByDownlinkMessageId) {
    if (boundTurnId === turnId) turnIdByDownlinkMessageId.delete(messageId)
  }
}

const claimPendingTurn = (
  workspaceId: string,
  predicate: (turn: WebRtcVoiceLatencyTurn) => boolean
) => {
  const pending = pendingTurnsByWorkspaceId.get(workspaceId)
  if (!pending || pending.length === 0) return null
  const index = pending.findIndex((turnId) => {
    const turn = turnsById.get(turnId)
    return turn ? predicate(turn) : false
  })
  if (index < 0) return null
  const [turnId] = pending.splice(index, 1)
  if (pending.length === 0) {
    pendingTurnsByWorkspaceId.delete(workspaceId)
  } else {
    pendingTurnsByWorkspaceId.set(workspaceId, pending)
  }
  return turnId ? (turnsById.get(turnId) ?? null) : null
}

export const startWebRtcVoiceLatencyTurn = ({
  callId,
  now = nowMs(),
  segment,
  speechStartAt,
  workspaceId,
}: WebRtcVoiceLatencyTurnInput): WebRtcVoiceLatencyTurn => {
  const baseTurnId = `${callId}-turn-${segment}`
  let turnId = baseTurnId
  let duplicateIndex = 2
  while (turnsById.has(turnId)) {
    turnId = `${baseTurnId}-${duplicateIndex}`
    duplicateIndex += 1
  }
  const turn: WebRtcVoiceLatencyTurn = {
    callId,
    finalAt: now,
    segment,
    ...(typeof speechStartAt === 'number' ? { speechStartAt } : {}),
    turnId,
    workspaceId,
  }
  turnsById.set(turn.turnId, turn)
  const pending = pendingTurnsByWorkspaceId.get(workspaceId) ?? []
  const nextPending = [...pending, turn.turnId]
  const overflow = nextPending.slice(0, Math.max(0, nextPending.length - 20))
  for (const droppedTurnId of overflow) {
    turnsById.delete(droppedTurnId)
    removeMessageBindingsForTurn(droppedTurnId)
  }
  pendingTurnsByWorkspaceId.set(workspaceId, nextPending.slice(-20))
  return turn
}

export const markWebRtcVoiceLatency = (
  turnId: string | undefined,
  fields: Partial<Omit<WebRtcVoiceLatencyTurn, 'callId' | 'turnId' | 'workspaceId'>>
) => {
  if (!turnId) return null
  const turn = turnsById.get(turnId)
  if (!turn) return null
  Object.assign(turn, fields)
  return turn
}

export const discardWebRtcVoiceLatencyTurn = (turnId: string | undefined) => {
  if (!turnId) return
  turnsById.delete(turnId)
  removePendingTurnId(turnId)
  removeMessageBindingsForTurn(turnId)
}

export const finishWebRtcVoiceLatencyTurn = (turnId: string | undefined) => {
  if (!turnId) return
  turnsById.delete(turnId)
  removePendingTurnId(turnId)
  removeMessageBindingsForTurn(turnId)
}

export const claimPendingWebRtcVoiceLatencyTurn = (workspaceId: string) => {
  return claimPendingTurn(workspaceId, () => true)
}

export const claimPendingLegacyWebRtcVoiceLatencyTurn = (workspaceId: string) =>
  claimPendingTurn(workspaceId, (turn) => !turn.branch)

export const claimOldestPendingWebRtcVoiceHandoffTurn = (
  workspaceId: string,
  scope: { callIds?: readonly string[] | ReadonlySet<string> } = {}
) => {
  const callIds =
    Array.isArray(scope.callIds) || scope.callIds instanceof Set ? new Set(scope.callIds) : null
  if (callIds && callIds.size === 0) return null
  return claimPendingTurn(
    workspaceId,
    (turn) =>
      turn.branch === 'escalate' &&
      turn.forwardPm === true &&
      (!callIds || callIds.has(turn.callId))
  )
}

export const bindWebRtcVoiceLatencyTurnToMessage = (
  turnId: string | undefined,
  messageId: string | undefined
) => {
  if (!turnId || !messageId || !turnsById.has(turnId)) return
  turnIdByDownlinkMessageId.set(messageId, turnId)
}

export const claimWebRtcVoiceLatencyTurnForMessage = (messageId: string | undefined) => {
  if (!messageId) return null
  const turnId = turnIdByDownlinkMessageId.get(messageId)
  if (!turnId) return null
  turnIdByDownlinkMessageId.delete(messageId)
  removePendingTurnId(turnId)
  return turnsById.get(turnId) ?? null
}

export const claimWebRtcVoiceLatencyTurnForId = (
  turnId: string | undefined,
  scope?: { callId?: string | undefined; workspaceId?: string | undefined }
) => {
  if (!turnId) return null
  const turn = turnsById.get(turnId)
  if (!turn) return null
  if (scope?.callId && turn.callId !== scope.callId) return null
  if (scope?.workspaceId && turn.workspaceId !== scope.workspaceId) return null
  removePendingTurnId(turnId)
  removeMessageBindingsForTurn(turnId)
  return turn
}

export const buildVoiceLatencyBreakdownLog = (
  turn: WebRtcVoiceLatencyTurn,
  options: { finalDownlinkField?: string; includeTtsToFirstFrame?: boolean } = {}
) => {
  const finalDownlinkField = options.finalDownlinkField ?? 'final_to_downlink_ms'
  const includeTtsToFirstFrame = options.includeTtsToFirstFrame ?? true
  const finalToFastReplyMs = duration(turn.finalAt, turn.fastReplyEnterAt)
  const glmMs = duration(turn.glmRequestAt, turn.glmResponseAt)
  const gatekeeperMs = duration(turn.fastReplyEnterAt, turn.gatekeeperAt)
  const ttsMs = duration(turn.ttsStartAt, turn.ttsEndAt)
  const ttsToFirstFrameMs = duration(turn.ttsEndAt, turn.firstDownlinkFrameAt)
  const finalToDownlinkMs = duration(turn.finalAt, turn.firstDownlinkFrameAt)
  return [
    'voice latency breakdown:',
    `call_id=${turn.callId}`,
    `turn_id=${turn.turnId}`,
    `segment=${turn.segment}`,
    'silence_to_final_ms=na',
    `final_to_fast_reply_ms=${formatDuration(finalToFastReplyMs)}`,
    `glm_ms=${formatDuration(glmMs)}`,
    `escalated=${turn.escalated === true}`,
    `gatekeeper_ms=${formatDuration(gatekeeperMs)}`,
    `tts_ms=${formatDuration(ttsMs)}`,
    ...(includeTtsToFirstFrame
      ? [`tts_to_first_frame_ms=${formatDuration(ttsToFirstFrameMs)}`]
      : []),
    `${finalDownlinkField}=${formatDuration(finalToDownlinkMs)}`,
    `total_ms=${formatDuration(finalToDownlinkMs)}`,
  ].join(' ')
}

export const buildVoiceTurnTimelineLog = (turn: WebRtcVoiceLatencyTurn) => {
  const speechToFinalMs = duration(turn.speechStartAt, turn.finalAt)
  const finalToVerdictMs = duration(turn.finalAt, turn.intentVerdictAt)
  const verdictToDispatchMs = duration(turn.intentVerdictAt, turn.decisionAt)
  const dispatchToDownlinkMs = duration(turn.decisionAt, turn.firstDownlinkFrameAt)
  const totalSpeechToAudioMs = duration(turn.speechStartAt, turn.firstDownlinkFrameAt)
  return [
    'voice turn timeline:',
    `call_id=${turn.callId}`,
    `turn=${turn.turnId}`,
    `branch=${turn.branch ?? 'na'}`,
    `forward_pm=${turn.forwardPm === true}`,
    `text_len=${typeof turn.textLen === 'number' ? turn.textLen : 'na'}`,
    `speech_to_final_ms=${formatDuration(speechToFinalMs)}`,
    `final_to_verdict_ms=${formatDuration(finalToVerdictMs)}`,
    `verdict_to_dispatch_ms=${formatDuration(verdictToDispatchMs)}`,
    `dispatch_to_downlink_ms=${formatDuration(dispatchToDownlinkMs)}`,
    `total_speech_to_audio_ms=${formatDuration(totalSpeechToAudioMs)}`,
  ].join(' ')
}

export const resetWebRtcVoiceLatencyForTests = () => {
  turnsById.clear()
  pendingTurnsByWorkspaceId.clear()
  turnIdByDownlinkMessageId.clear()
}
