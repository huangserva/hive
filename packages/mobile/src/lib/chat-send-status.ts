export type ChatSendOutcome = 'error' | 'queued' | 'sent'

export interface ChatSendOutcomeInput {
  queued: boolean
  sendSucceeded: boolean
  syncSucceeded: boolean
}

export const resolveChatSendOutcome = ({
  queued,
  sendSucceeded,
}: ChatSendOutcomeInput): ChatSendOutcome => {
  if (sendSucceeded) return 'sent'
  if (queued) return 'queued'
  return 'error'
}
