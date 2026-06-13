import type { HiveLogger } from './logger.js'
import type { RuntimeStore } from './runtime-store.js'

export interface FeishuInboundChatEvent {
  chatId: string
  imagePath?: string | undefined
  /**
   * M44: 入站视频/文件下载到 uploads 后的本地路径。区别于 `imagePath`（图片专用，
   * orch 默认 Read 看），媒体路径让 orch 知道附件存哪、可按需取用（不强制 Read）。
   */
  mediaPath?: string | undefined
  /** M44: 入站附件的原始文件名（如 demo.mp4），方便 orch 引用 / 飞书回引。 */
  mediaFileName?: string | undefined
  messageId?: string | undefined
  senderName: string
  sourceType?: 'file' | 'image' | 'text' | 'video' | 'voice'
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

export const formatFeishuInboundPrompt = (event: FeishuInboundChatEvent) => {
  const base = `chat=${event.chatId}，sender=${event.senderName} user_id=${event.userId}${event.messageId ? ` message_id=${event.messageId}` : ''}`
  // M44: 视频/文件用 media= 标签；图片仍用 image= 兼容旧 orch 行为。
  const mediaSuffix = event.mediaPath
    ? ` media=${event.mediaPath}${event.mediaFileName ? ` file_name=${event.mediaFileName}` : ''}`
    : ''
  const header =
    event.sourceType === 'voice'
      ? `[来自飞书语音] ${base}`
      : event.sourceType === 'video'
        ? `[来自飞书视频] ${base}${mediaSuffix}`
        : event.sourceType === 'file'
          ? `[来自飞书文件] ${base}${mediaSuffix}`
          : `[来自飞书 ${base}${event.imagePath ? ` image=${event.imagePath}` : ''}${mediaSuffix}]`
  return [header, '请用 team feishu reply 回复（Phase 2 接通后生效）。', '---', event.text].join(
    '\n'
  )
}

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
