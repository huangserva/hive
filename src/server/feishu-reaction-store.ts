export class FeishuReactionStore {
  private readonly latestByChat = new Map<string, string>()
  private readonly reactions = new Map<string, string>()

  getLatestForChat(chatId: string): string | undefined {
    return this.latestByChat.get(chatId)
  }

  set(messageId: string, reactionId: string): void {
    this.reactions.set(messageId, reactionId)
  }

  setLatestForChat(chatId: string, messageId: string): void {
    this.latestByChat.set(chatId, messageId)
  }

  take(messageId: string): string | undefined {
    const reactionId = this.reactions.get(messageId)
    this.reactions.delete(messageId)
    return reactionId
  }
}
