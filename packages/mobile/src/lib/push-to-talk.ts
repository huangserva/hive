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
  if (state === 'idle' && event.type === 'recordStart') return 'recording'
  if (state === 'recording' && event.type === 'recordStop') return 'sending'
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
  sendPromptToOrchestratorWithOutcome: (text: string) => Promise<ChatSendOutcome>
  transcribeVoice: (audioBase64: string, format?: string) => Promise<string | null>
}): Promise<{ outcome: ChatSendOutcome; text: string }> => {
  const transcript = (await transcribeVoice(audioBase64, format))?.trim()
  if (!transcript) {
    throw new Error('No speech was transcribed')
  }
  const outcome = await sendPromptToOrchestratorWithOutcome(transcript)
  return { outcome, text: transcript }
}

type TalkbackMessage = {
  content_json: string
  created_at: number
  id: string
  message_type: string
}

const parseMessageText = (contentJson: string) => {
  try {
    const parsed = JSON.parse(contentJson) as { text?: unknown }
    if (typeof parsed.text === 'string') return parsed.text.trim()
  } catch {
    return contentJson.trim()
  }
  return contentJson.trim()
}

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
  const replies = messages
    .filter((message) => message.message_type === 'orch_reply')
    .sort((a, b) => a.created_at - b.created_at)
  if (baselineReplyIds) {
    const nextReply = replies.find((message) => !baselineReplyIds.has(message.id)) ?? null
    if (!nextReply) return null
    const text = parseMessageText(nextReply.content_json)
    return text ? { id: nextReply.id, text } : null
  }
  const lastIndex = lastSpokenReplyId
    ? replies.findIndex((message) => message.id === lastSpokenReplyId)
    : -1
  const nextReply =
    lastIndex >= 0 ? replies.slice(lastIndex + 1).find(Boolean) : (replies.at(-1) ?? null)
  if (!nextReply) return null
  const text = parseMessageText(nextReply.content_json)
  return text ? { id: nextReply.id, text } : null
}
