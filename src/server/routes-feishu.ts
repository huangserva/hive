import { BadRequestError, HttpError, UnauthorizedError } from './http-errors.js'
import { readJsonBody, route, sendJson } from './route-helpers.js'
import type { RouteDefinition } from './route-types.js'
import { requireUiTokenFromRequest } from './ui-auth-helpers.js'

interface FeishuOutboundBody {
  chatId?: unknown
  text?: unknown
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
      const text = requireText(body.text)
      const chatId = optionalChatId(body.chatId) ?? feishuTransport.getLastChatForAgent(agentId)
      if (!chatId) {
        throw new BadRequestError('no recent feishu chat for this agent')
      }

      await feishuTransport.sendMessage(chatId, text)
      sendJson(response, 200, { ok: true })
    }
  ),
]
