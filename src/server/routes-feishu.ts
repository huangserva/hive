import { BadRequestError, HttpError, UnauthorizedError } from './http-errors.js'
import { readJsonBody, route, sendJson } from './route-helpers.js'
import type { RouteDefinition } from './route-types.js'

interface FeishuOutboundBody {
  chatId?: unknown
  text?: unknown
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

const optionalChatId = (value: unknown) => {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestError('chatId must be a non-empty string')
  }
  return value.trim()
}

export const feishuRoutes: RouteDefinition[] = [
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
