import type { MobilePromptSource } from '../api/client'
import type { ChatSendOutcome } from './chat-send-status'

export type TalkbackState =
  | 'idle'
  | 'listening'
  | 'capturing'
  | 'processing'
  | 'recording'
  | 'sending'
  | 'waiting_for_orchestrator'
  | 'speaking'
  | 'error'

export type TalkbackEvent =
  | { type: 'recordStart' }
  | { type: 'recordStop' }
  | { type: 'continuousStart' }
  | { type: 'continuousStop' }
  | { type: 'voiceDetected' }
  | { type: 'silenceDetected' }
  | { type: 'promptQueued' }
  | { type: 'replyDetected' }
  | { continueListening?: boolean; type: 'playbackFinished' }
  | { message: string; type: 'failed' }
  | { type: 'reset' }

export const reduceTalkbackState = (state: TalkbackState, event: TalkbackEvent): TalkbackState => {
  if (event.type === 'failed') return 'error'
  if (event.type === 'reset') return 'idle'
  if (event.type === 'continuousStart' && (state === 'idle' || state === 'error')) {
    return 'listening'
  }
  if (event.type === 'continuousStop') return 'idle'
  if (state === 'listening' && event.type === 'voiceDetected') return 'capturing'
  if (state === 'capturing' && event.type === 'silenceDetected') return 'processing'
  if (state === 'speaking' && event.type === 'voiceDetected') return 'capturing'
  if (state === 'idle' && event.type === 'recordStart') return 'recording'
  if (state === 'recording' && event.type === 'recordStop') return 'sending'
  if ((state === 'idle' || state === 'listening') && event.type === 'replyDetected') {
    return 'speaking'
  }
  if (state === 'sending' && event.type === 'promptQueued') return 'waiting_for_orchestrator'
  if (state === 'processing' && event.type === 'promptQueued') return 'processing'
  if (state === 'processing' && event.type === 'replyDetected') return 'speaking'
  if (state === 'waiting_for_orchestrator' && event.type === 'replyDetected') return 'speaking'
  if (state === 'speaking' && event.type === 'playbackFinished') {
    return event.continueListening ? 'listening' : 'idle'
  }
  return state
}

export const runTalkbackInput = async ({
  audioBase64,
  format,
  sendPromptToOrchestratorWithOutcome,
  transcribeVoice,
}: {
  audioBase64: string
  format: string
  sendPromptToOrchestratorWithOutcome: (
    text: string,
    options?: { source?: MobilePromptSource }
  ) => Promise<ChatSendOutcome>
  transcribeVoice: (audioBase64: string, format?: string) => Promise<string | null>
}): Promise<{ outcome: ChatSendOutcome; text: string }> => {
  const transcript = (await transcribeVoice(audioBase64, format))?.trim()
  if (!transcript) {
    throw new Error('No speech was transcribed')
  }
  const outcome = await sendPromptToOrchestratorWithOutcome(transcript, { source: 'voice' })
  return { outcome, text: transcript }
}

type TalkbackMessage = {
  content_json: string
  created_at: number
  id: string
  message_type: string
}

export type TalkbackReply = {
  createdAt: number
  id: string
  text: string
  voice: string
}

export const TALKBACK_FAST_REPLY_VOICE = 'zh-CN-XiaoxiaoNeural'
export const TALKBACK_ORCHESTRATOR_REPLY_VOICE = 'zh-CN-YunxiNeural'

const parseMessageContent = (contentJson: string) => {
  try {
    const parsed = JSON.parse(contentJson) as {
      fast_reply?: unknown
      source?: unknown
      text?: unknown
    }
    if (typeof parsed.text === 'string') {
      return {
        fastReply: parsed.fast_reply === true || parsed.source === 'voice_fast_reply',
        text: parsed.text.trim(),
      }
    }
  } catch {
    return { fastReply: false, text: contentJson.trim() }
  }
  return { fastReply: false, text: contentJson.trim() }
}

const parseMessageText = (contentJson: string) => parseMessageContent(contentJson).text

export const resolveTalkbackReplyVoice = (contentJson: string) =>
  parseMessageContent(contentJson).fastReply
    ? TALKBACK_FAST_REPLY_VOICE
    : TALKBACK_ORCHESTRATOR_REPLY_VOICE

export const findNextTalkbackReply = ({
  baselineReplyIds,
  enabled,
  lastSpokenReplyId,
  messages,
}: {
  baselineReplyIds?: ReadonlySet<string> | null
  enabled: boolean
  lastSpokenReplyId: string | null
  messages: TalkbackMessage[]
}): { id: string; text: string } | null => {
  if (!enabled) return null
  const queuedReply = listPendingTalkbackReplies({
    baselineReplyIds,
    enabled,
    messages,
    spokenReplyIds: lastSpokenReplyId ? new Set([lastSpokenReplyId]) : undefined,
  }).at(0)
  if (baselineReplyIds && queuedReply) return { id: queuedReply.id, text: queuedReply.text }
  if (baselineReplyIds) return null

  const replies = messages
    .filter((message) => message.message_type === 'orch_reply')
    .sort((a, b) => a.created_at - b.created_at)
  const lastIndex = lastSpokenReplyId
    ? replies.findIndex((message) => message.id === lastSpokenReplyId)
    : -1
  const nextReply =
    lastIndex >= 0 ? replies.slice(lastIndex + 1).find(Boolean) : (replies.at(-1) ?? null)
  if (!nextReply) return null
  const text = parseMessageText(nextReply.content_json)
  return text ? { id: nextReply.id, text } : null
}

export const listPendingTalkbackReplies = ({
  activePlaybackReplyId,
  baselineReplyIds,
  enabled,
  inFlightReplyId,
  messages,
  spokenReplyIds,
}: {
  activePlaybackReplyId?: string | null
  baselineReplyIds?: ReadonlySet<string> | null
  enabled: boolean
  inFlightReplyId?: string | null
  messages: TalkbackMessage[]
  spokenReplyIds?: ReadonlySet<string> | null
}): TalkbackReply[] => {
  if (!enabled) return []
  return messages
    .filter((message) => message.message_type === 'orch_reply')
    .filter((message) => !baselineReplyIds?.has(message.id))
    .filter((message) => !spokenReplyIds?.has(message.id))
    .filter((message) => message.id !== inFlightReplyId)
    .filter((message) => message.id !== activePlaybackReplyId)
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
    .map((message) => ({
      createdAt: message.created_at,
      id: message.id,
      text: parseMessageText(message.content_json),
      voice: resolveTalkbackReplyVoice(message.content_json),
    }))
    .filter((reply) => reply.text.length > 0)
}

export const shouldFinishTalkbackReplyRound = ({
  activePlaybackReplyId,
  idleTimeoutMs,
  inFlightReplyId,
  lastPlaybackFinishedAtMs,
  nowMs,
  pendingReplyCount,
}: {
  activePlaybackReplyId: string | null
  idleTimeoutMs: number
  inFlightReplyId: string | null
  lastPlaybackFinishedAtMs: number | null
  nowMs: number
  pendingReplyCount: number
}) =>
  lastPlaybackFinishedAtMs !== null &&
  !activePlaybackReplyId &&
  !inFlightReplyId &&
  pendingReplyCount === 0 &&
  nowMs - lastPlaybackFinishedAtMs >= idleTimeoutMs
