import { isAbsolute, resolve } from 'node:path'

import { BadRequestError, HttpError, UnauthorizedError } from './http-errors.js'
import { readJsonBody, route, sendJson } from './route-helpers.js'
import type { RouteDefinition } from './route-types.js'
import { requireUiTokenFromRequest } from './ui-auth-helpers.js'

interface FeishuOutboundBody {
  chatId?: unknown
  /** M44: 媒体路径（可选）；存在时 text 当 caption，可空字符串。 */
  file?: unknown
  messageId?: unknown
  text?: unknown
}

interface FeishuApprovalRequestBody {
  action?: unknown
  chatId?: unknown
  risk?: unknown
  target?: unknown
  workspaceId?: unknown
}

interface BindFeishuChatBody {
  chatId?: unknown
  chatName?: unknown
  workspaceId?: unknown
}

const getBearerToken = (authorization: string | string[] | undefined) => {
  const value = Array.isArray(authorization) ? authorization[0] : authorization
  if (!value) return undefined
  const match = /^Bearer\s+(.+)$/i.exec(value)
  return match?.[1]
}

const getAgentId = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

const requireText = (value: unknown) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestError('Missing text')
  }
  return value
}

const requireString = (value: unknown, field: string) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestError(`Missing ${field}`)
  }
  return value.trim()
}

const optionalChatId = (value: unknown) => {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestError('chatId must be a non-empty string')
  }
  return value.trim()
}

const optionalMessageId = (value: unknown) => {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestError('messageId must be a non-empty string')
  }
  return value.trim()
}

const requireRisk = (value: unknown) => {
  if (value === undefined || value === null) return 'high'
  if (value !== 'high' && value !== 'medium') {
    throw new BadRequestError('risk must be high or medium')
  }
  return value
}

// M44: --file <path> 解析 + 相对路径归一到 cwd 绝对路径（与 mobile-send-media 同款契约）。
const optionalFile = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestError('file must be a non-empty string')
  }
  const trimmed = value.trim()
  return isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed)
}

// M44: caption（媒体路径下的可选 text 字段）；允许 undefined / 空串。
const optionalCaption = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new BadRequestError('text must be a string when file is provided')
  }
  return value
}

const optionalTarget = (value: unknown) => {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    throw new BadRequestError('target must be a string')
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export const feishuRoutes: RouteDefinition[] = [
  route('GET', '/api/feishu/transport-status', ({ feishuTransport, request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    if (!feishuTransport) {
      sendJson(response, 200, { status: 'disabled' })
      return
    }
    const status = feishuTransport.getStatus()
    sendJson(response, 200, {
      appId: status.appId,
      reconnectCount: status.reconnectCount,
      status: status.state,
    })
  }),
  route('GET', '/api/feishu/bindings', ({ request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const workspaceId = url.searchParams.get('workspaceId') ?? undefined
    sendJson(response, 200, store.listFeishuBindings(workspaceId))
  }),
  route('POST', '/api/feishu/bindings', async ({ request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    const body = await readJsonBody<BindFeishuChatBody>(request)
    const workspaceId = requireString(body.workspaceId, 'workspaceId')
    const chatId = requireString(body.chatId, 'chatId')
    const chatName =
      typeof body.chatName === 'string' && body.chatName.trim() ? body.chatName.trim() : null
    sendJson(response, 201, store.bindFeishuChat({ workspaceId, chatId, chatName }))
  }),
  route('DELETE', '/api/feishu/bindings/:chatId', ({ params, request, response, store }) => {
    requireUiTokenFromRequest(request, store.validateUiToken)
    const chatId = requireString(params.chatId, 'chatId')
    sendJson(response, 200, { deleted: store.unbindFeishuChat(chatId) })
  }),
  route(
    'POST',
    '/internal/feishu/outbound',
    async ({ feishuTransport, request, response, store }) => {
      const agentId = getAgentId(request.headers['x-hive-agent-id'])
      const token = getBearerToken(request.headers.authorization)
      if (!agentId) {
        throw new UnauthorizedError('Missing agent identity')
      }
      if (!store.validateAgentToken(agentId, token)) {
        throw new UnauthorizedError('Invalid or missing agent token')
      }
      if (!feishuTransport) {
        throw new HttpError(503, 'feishu transport not configured')
      }

      const body = await readJsonBody<FeishuOutboundBody>(request)
      // M44: 媒体出站路径 —— 有 file 字段时不要求 text 必填（caption 选填）。
      const rawFile = body.file
      const filePath = optionalFile(rawFile)
      const text = filePath === undefined ? requireText(body.text) : optionalCaption(body.text)
      const chatId = optionalChatId(body.chatId) ?? feishuTransport.getLastChatForAgent(agentId)
      if (!chatId) {
        throw new BadRequestError('no recent feishu chat for this agent')
      }
      const messageId =
        optionalMessageId(body.messageId) ?? feishuTransport.getLatestMessageForChat?.(chatId)

      if (filePath !== undefined) {
        // 媒体路径：caption 仅在 trim 后非空时透传（与 transport 内部 trim 一致；route 层先 trim
        // 避免 sendMedia 收到全空白 caption，与穿透测试期望一致）。
        const trimmedCaption = text?.trim()
        await feishuTransport.sendMedia({
          chatId,
          filePath,
          ...(trimmedCaption ? { caption: trimmedCaption } : {}),
        })
      } else {
        await feishuTransport.sendMessage(chatId, text ?? '')
      }
      if (messageId) {
        await feishuTransport.markReplyDelivered?.(messageId)
      }
      sendJson(response, 200, { ok: true })
    }
  ),
  route(
    'POST',
    '/internal/feishu/approval-request',
    async ({ feishuTransport, logger, mobilePushService, request, response, store }) => {
      const agentId = getAgentId(request.headers['x-hive-agent-id'])
      const token = getBearerToken(request.headers.authorization)
      if (!agentId) {
        throw new UnauthorizedError('Missing agent identity')
      }
      if (!store.validateAgentToken(agentId, token)) {
        throw new UnauthorizedError('Invalid or missing agent token')
      }
      if (!feishuTransport) {
        throw new HttpError(503, 'feishu transport not configured')
      }

      const body = await readJsonBody<FeishuApprovalRequestBody>(request)
      const action = requireString(body.action, 'action')
      const workspaceId = requireString(body.workspaceId, 'workspaceId')
      const workspace = store.getWorkspaceSnapshot(workspaceId)
      const risk = requireRisk(body.risk)
      const target = optionalTarget(body.target)
      const chatId = optionalChatId(body.chatId) ?? feishuTransport.getLastChatForAgent(agentId)
      if (!chatId) {
        throw new BadRequestError('no recent feishu chat for this agent')
      }

      const approval = store.approvalLedger.create({
        action,
        chatId,
        messageId: '',
        orchAgentId: agentId,
        risk,
        target,
        workspaceId,
      })
      // Persist the request to the mobile chat thread so the phone renders an
      // inline approve/deny card (the high-risk approval gate on the phone). The
      // mobile resolve path (/api/mobile/.../approve/:approvalId) needs no Feishu,
      // so once this row exists the gate works from the phone.
      store.insertMobileChatMessage(
        workspaceId,
        'outbound',
        'approval_request',
        JSON.stringify({ action, approval_id: approval.approvalId, risk, target })
      )
      logger?.info(
        `feishu approval created approval_id=${approval.approvalId} risk=${risk} action=${JSON.stringify(action)}`
      )
      const card = await feishuTransport.sendApprovalCard({
        action,
        approvalId: approval.approvalId,
        chatId,
        risk,
        target,
        workspaceName: workspace.summary.name,
      })
      store.approvalLedger.setMessageId(approval.approvalId, card.messageId)
      await mobilePushService
        ?.notifyApprovalRequested(workspaceId, {
          action,
          approvalId: approval.approvalId,
          risk,
        })
        .catch((error) => {
          logger?.error(`mobile approval push failed approval_id=${approval.approvalId}`, error)
        })
      logger?.info(
        `feishu approval card sent message_id=${card.messageId} chat_id=${chatId} approval_id=${approval.approvalId}`
      )
      sendJson(response, 200, {
        approval_id: approval.approvalId,
        message_id: card.messageId,
      })
    }
  ),
]
