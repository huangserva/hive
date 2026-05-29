interface FeishuReactionEntry {
  createdAt: number
  reactionId: string
}

export interface FeishuReactionStoreOptions {
  maxReactions?: number
  now?: () => number
  ttlMs?: number
}

const DEFAULT_MAX_REACTIONS = 1000
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

export class FeishuReactionStore {
  private readonly maxReactions: number
  private readonly latestByChat = new Map<string, string>()
  private readonly now: () => number
  private readonly reactions = new Map<string, FeishuReactionEntry>()
  private readonly ttlMs: number

  constructor(options: FeishuReactionStoreOptions = {}) {
    this.maxReactions = Math.max(1, Math.trunc(options.maxReactions ?? DEFAULT_MAX_REACTIONS))
    this.now = options.now ?? Date.now
    this.ttlMs = Math.max(1, Math.trunc(options.ttlMs ?? DEFAULT_TTL_MS))
  }

  getLatestForChat(chatId: string): string | undefined {
    return this.latestByChat.get(chatId)
  }

  set(messageId: string, reactionId: string): void {
    this.pruneExpired(this.now())
    this.reactions.set(messageId, { createdAt: this.now(), reactionId })
    while (this.reactions.size > this.maxReactions) {
      const oldestMessageId = this.reactions.keys().next().value
      if (typeof oldestMessageId !== 'string') break
      this.reactions.delete(oldestMessageId)
    }
  }

  setLatestForChat(chatId: string, messageId: string): void {
    this.latestByChat.set(chatId, messageId)
  }

  take(messageId: string, now = this.now()): string | undefined {
    this.pruneExpired(now)
    const entry = this.reactions.get(messageId)
    this.reactions.delete(messageId)
    return entry?.reactionId
  }

  private pruneExpired(now: number): void {
    const expiresBefore = now - this.ttlMs
    for (const [messageId, entry] of this.reactions) {
      if (entry.createdAt > expiresBefore) continue
      this.reactions.delete(messageId)
    }
  }
}
