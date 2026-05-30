import type { HiveLogger } from './logger.js'
import type { RuntimeStore } from './runtime-store.js'

export interface FeishuInboundChatEvent {
  chatId: string
  imagePath?: string | undefined
  messageId?: string | undefined
  senderName: string
  sourceType?: 'image' | 'text' | 'voice'
  text: string
  userId: string
}

export interface FeishuInboundRoute {
  orchestratorAgentId: string
  workspaceId: string
}

type FeishuInboundStore = Pick<RuntimeStore, 'recordUserInput'>
type FeishuInboundAgentRuntime = Pick<RuntimeStore, 'getActiveRunByAgentId'>

interface HandleFeishuInboundInput {
  agentRuntime: FeishuInboundAgentRuntime
  event: FeishuInboundChatEvent
  logger: HiveLogger
  replyText?: (chatId: string, text: string) => Promise<void>
  route: FeishuInboundRoute
  store: FeishuInboundStore
}

export const FEISHU_ORCHESTRATOR_OFFLINE_TEXT =
  'Orchestrator 当前未运行，请在 hive web UI 点 Restart'

export const formatFeishuInboundPrompt = (event: FeishuInboundChatEvent) =>
  [
    event.sourceType === 'voice'
      ? `[来自飞书语音] chat=${event.chatId}，sender=${event.senderName} user_id=${event.userId}${event.messageId ? ` message_id=${event.messageId}` : ''}`
      : `[来自飞书 chat=${event.chatId}，sender=${event.senderName} user_id=${event.userId}${event.messageId ? ` message_id=${event.messageId}` : ''}${event.imagePath ? ` image=${event.imagePath}` : ''}]`,
    '请用 team feishu reply 回复（Phase 2 接通后生效）。',
    '---',
    event.text,
  ].join('\n')

export const handleFeishuInbound = async ({
  agentRuntime,
  event,
  logger,
  replyText,
  route,
  store,
}: HandleFeishuInboundInput): Promise<void> => {
  const activeRun = agentRuntime.getActiveRunByAgentId(route.workspaceId, route.orchestratorAgentId)
  if (!activeRun) {
    logger.warn(
      `feishu inbound dropped reason=orchestrator_offline chat_id=${event.chatId} workspace_id=${route.workspaceId}`
    )
    if (replyText) {
      try {
        await replyText(event.chatId, FEISHU_ORCHESTRATOR_OFFLINE_TEXT)
      } catch (error) {
        logger.error(`feishu offline reply failed chat_id=${event.chatId}`, error)
      }
    }
    return
  }

  store.recordUserInput(
    route.workspaceId,
    route.orchestratorAgentId,
    formatFeishuInboundPrompt(event)
  )
  logger.info(
    `feishu inbound injected chat_id=${event.chatId} workspace_id=${route.workspaceId} agent_id=${route.orchestratorAgentId}`
  )
}
