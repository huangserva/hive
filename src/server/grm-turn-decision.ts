import type { FastVoiceReplyResult } from './fast-voice-reply.js'
import type { VoiceIntentSessionUpdate, VoiceIntentVerdict } from './voice-intent-front.js'

export type GrmTurnSource = 'mobile_text' | 'mobile_voice' | 'talk_continuous' | 'webrtc_call'
export type GrmTurnDecisionAction = 'clarify' | 'drop' | 'escalate' | 'handled'
export type GrmTurnDecisionBranch = 'drop' | 'escalate' | 'fallback' | 'handled' | 'incomplete'
export type GrmTurnDecisionOrigin = 'legacy_gatekeeper' | 'safe_fallback' | 'voice_intent'

export type GrmTurnDecision = {
  action: GrmTurnDecisionAction
  allowPmHandoff: boolean
  branch: GrmTurnDecisionBranch
  completeness: 'complete' | 'incomplete' | 'likely_complete'
  confidence: number
  distilledIntent: string
  origin: GrmTurnDecisionOrigin
  replyText: string
  requiresPmReason: string | null
  risk: string | null
  source: GrmTurnSource
  turnId: string | null
}

type DecisionInput = {
  source: GrmTurnSource
  transcript: string
  turnId?: string | null
}

type VoiceIntentDecisionInput = DecisionInput & {
  update: Extract<VoiceIntentSessionUpdate, { status: 'accepted' }>
}

type FastReplyDecisionInput = DecisionInput & {
  fastReply: FastVoiceReplyResult
}

const normalizeText = (text: string) => text.replace(/\s+/g, ' ').trim()

export const classifyGrmRequiresPm = (transcript: string) => {
  const text = normalizeText(transcript)
  if (!text) return null

  if (/(?:派|安排).{0,12}(?:关羽|赵云|worker|团队|人|谁|工程师|coder|tester|reviewer)/iu.test(text))
    return 'assign_worker'
  if (
    /(?:让|请).{0,8}(?:关羽|赵云|钟馗|马超|worker|团队|人|谁|工程师|coder|tester|reviewer).{0,16}(?:修|处理|排查|看)/iu.test(
      text
    )
  )
    return 'assign_worker'
  if (/(?:改代码|写代码|修代码|修复|实现|接入|部署|重启|发版|出包|打包)/u.test(text))
    return 'execute_engineering_work'
  if (
    /(?:查证|帮我查|查一下|看一下).{0,20}(?:线上|真实|日志|错误|报错|服务|部署|状态|当前)/u.test(
      text
    )
  )
    return 'verify_unknown_runtime_state'
  if (/(?:PM|主管|你|团队).{0,12}(?:拍板|决定|决策)|(?:拍板|做决定)/iu.test(text))
    return 'pm_decision'

  return null
}

const buildBaseDecision = ({
  action,
  allowPmHandoff,
  branch,
  completeness,
  confidence,
  distilledIntent,
  origin,
  replyText,
  requiresPmReason,
  risk,
  source,
  turnId,
}: GrmTurnDecision): GrmTurnDecision => ({
  action,
  allowPmHandoff,
  branch,
  completeness,
  confidence,
  distilledIntent: normalizeText(distilledIntent).slice(0, 500),
  origin,
  replyText: normalizeText(replyText).slice(0, 180),
  requiresPmReason,
  risk,
  source,
  turnId,
})

const applyExplicitWorkOverride = ({
  decision,
  transcript,
}: {
  decision: GrmTurnDecision
  transcript: string
}) => {
  const reason = classifyGrmRequiresPm(transcript)
  if (!reason || decision.branch === 'drop' || decision.branch === 'incomplete') return decision
  if (decision.branch === 'escalate') {
    return {
      ...decision,
      allowPmHandoff: true,
      requiresPmReason: decision.requiresPmReason ?? reason,
      risk: decision.risk ?? 'explicit_work_request',
    }
  }
  return {
    ...decision,
    action: 'escalate',
    allowPmHandoff: true,
    branch: 'escalate',
    distilledIntent: decision.distilledIntent || normalizeText(transcript).slice(0, 500),
    replyText: '好，这个我转给主管。',
    requiresPmReason: reason,
    risk: 'model_marked_actionable_as_handled',
  } satisfies GrmTurnDecision
}

const isSafeVoiceIntentFallback = (verdict: VoiceIntentVerdict) =>
  verdict.action === 'drop' && verdict.confidence <= 0 && !verdict.reply_text.trim()

export const adaptVoiceIntentToGrmTurnDecision = ({
  source,
  transcript,
  turnId = null,
  update,
}: VoiceIntentDecisionInput): GrmTurnDecision => {
  const verdict = update.verdict
  if (isSafeVoiceIntentFallback(verdict)) {
    return adaptSafeFallbackToGrmTurnDecision({ source, transcript, turnId })
  }

  const hasQualifiedHandoff = Boolean(update.handoff)
  const handoffIntent = update.handoff?.distilledIntent || verdict.distilled_intent
  const complete = verdict.completeness === 'complete'
  const branch: GrmTurnDecisionBranch =
    verdict.action === 'drop'
      ? 'drop'
      : !complete
        ? 'incomplete'
        : verdict.action === 'escalate' && hasQualifiedHandoff
          ? 'escalate'
          : 'handled'
  const action: GrmTurnDecisionAction =
    complete && verdict.action === 'escalate' && !hasQualifiedHandoff ? 'handled' : verdict.action

  const decision = buildBaseDecision({
    action,
    allowPmHandoff: branch === 'escalate',
    branch,
    completeness: verdict.completeness,
    confidence: verdict.confidence,
    distilledIntent: complete ? handoffIntent || transcript : handoffIntent,
    origin: 'voice_intent',
    replyText: verdict.reply_text,
    requiresPmReason: branch === 'escalate' ? 'voice_intent_handoff' : null,
    risk:
      complete && verdict.action === 'escalate' && !hasQualifiedHandoff
        ? 'low_confidence_escalate_without_handoff'
        : null,
    source,
    turnId,
  })
  return applyExplicitWorkOverride({ decision, transcript })
}

export const adaptFastVoiceReplyToGrmTurnDecision = ({
  fastReply,
  source,
  transcript,
  turnId = null,
}: FastReplyDecisionInput): GrmTurnDecision => {
  const branch: GrmTurnDecisionBranch =
    fastReply.gatekeeper === 'drop'
      ? 'drop'
      : fastReply.gatekeeper === 'escalate'
        ? 'escalate'
        : 'handled'
  const decision = buildBaseDecision({
    action: fastReply.gatekeeper === 'drop' ? 'drop' : fastReply.gatekeeper,
    allowPmHandoff: branch === 'escalate',
    branch,
    completeness: branch === 'drop' ? 'incomplete' : 'complete',
    confidence: branch === 'drop' ? 0 : 1,
    distilledIntent: branch === 'escalate' ? transcript : '',
    origin: 'legacy_gatekeeper',
    replyText: fastReply.reply ?? '',
    requiresPmReason: branch === 'escalate' ? 'legacy_gatekeeper_escalate' : null,
    risk: null,
    source,
    turnId,
  })
  return applyExplicitWorkOverride({ decision, transcript })
}

export const adaptSafeFallbackToGrmTurnDecision = ({
  source,
  transcript,
  turnId = null,
}: DecisionInput): GrmTurnDecision =>
  buildBaseDecision({
    action: 'drop',
    allowPmHandoff: false,
    branch: 'fallback',
    completeness: 'incomplete',
    confidence: 0,
    distilledIntent: transcript,
    origin: 'safe_fallback',
    replyText: '',
    requiresPmReason: null,
    risk: 'safe_zero_confidence',
    source,
    turnId,
  })
