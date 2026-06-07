type WebRtcVoiceLatencyTurnInput = {
  callId: string
  now?: number
  segment: number
  workspaceId: string
}

export type WebRtcVoiceLatencyTurn = {
  callId: string
  escalated?: boolean
  fastReplyEnterAt?: number
  finalAt: number
  firstDownlinkFrameAt?: number
  gatekeeperAt?: number
  glmRequestAt?: number
  glmResponseAt?: number
  segment: number
  ttsEndAt?: number
  ttsStartAt?: number
  turnId: string
  workspaceId: string
}

const turnsById = new Map<string, WebRtcVoiceLatencyTurn>()
const pendingTurnsByWorkspaceId = new Map<string, string[]>()

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

export const startWebRtcVoiceLatencyTurn = ({
  callId,
  now = nowMs(),
  segment,
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
    turnId,
    workspaceId,
  }
  turnsById.set(turn.turnId, turn)
  const pending = pendingTurnsByWorkspaceId.get(workspaceId) ?? []
  const nextPending = [...pending, turn.turnId]
  const overflow = nextPending.slice(0, Math.max(0, nextPending.length - 20))
  for (const droppedTurnId of overflow) turnsById.delete(droppedTurnId)
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
}

export const finishWebRtcVoiceLatencyTurn = (turnId: string | undefined) => {
  if (!turnId) return
  turnsById.delete(turnId)
  removePendingTurnId(turnId)
}

export const claimPendingWebRtcVoiceLatencyTurn = (workspaceId: string) => {
  const pending = pendingTurnsByWorkspaceId.get(workspaceId)
  if (!pending || pending.length === 0) return null
  const turnId = pending.shift()
  if (pending.length === 0) {
    pendingTurnsByWorkspaceId.delete(workspaceId)
  } else {
    pendingTurnsByWorkspaceId.set(workspaceId, pending)
  }
  return turnId ? (turnsById.get(turnId) ?? null) : null
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

export const resetWebRtcVoiceLatencyForTests = () => {
  turnsById.clear()
  pendingTurnsByWorkspaceId.clear()
}
