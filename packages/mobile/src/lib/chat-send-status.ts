export type ChatSendOutcome = 'error' | 'queued' | 'sent'

export interface ChatSendOutcomeInput {
  queued: boolean
  sent: boolean
}

export const resolveChatSendOutcome = ({ queued, sent }: ChatSendOutcomeInput): ChatSendOutcome => {
  if (sent) return 'sent'
  if (queued) return 'queued'
  return 'error'
}
