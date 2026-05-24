import { parseCockpit } from './cockpit-doc.js'
import { BadRequestError } from './http-errors.js'
import { openWorkspaceFile } from './open-file.js'
import { confirmDecisionInFile } from './pm-decisions-doc.js'
import { type IdeaPromoteTarget, promoteIdeaInFile } from './pm-ideas-doc.js'
import { answerQuestionInFile } from './pm-questions-doc.js'
import { getRequiredParam, readJsonBody, route, sendJson } from './route-helpers.js'
import type { RouteDefinition } from './route-types.js'
import { requireUiTokenFromRequest } from './ui-auth-helpers.js'

interface AnswerQuestionBody {
  answer?: unknown
}

interface PromoteIdeaBody {
  target?: unknown
}

interface OpenFileBody {
  path?: unknown
}

export const cockpitRoutes: RouteDefinition[] = [
  route('GET', '/api/workspaces/:workspaceId/cockpit', ({ params, request, response, store }) => {
    const workspaceId = getRequiredParam(
      response,
      params,
      'workspaceId',
      'Workspace id is required'
    )
    if (!workspaceId) return

    requireUiTokenFromRequest(request, store.validateUiToken)

    const workspace = store.getWorkspaceSnapshot(workspaceId)
    sendJson(response, 200, parseCockpit(workspace.summary.path))
  }),
  route(
    'POST',
    '/api/workspaces/:workspaceId/cockpit/questions/:questionId/answer',
    async ({ params, request, response, store }) => {
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      const questionId = getRequiredParam(response, params, 'questionId', 'Question id is required')
      if (!workspaceId || !questionId) return

      requireUiTokenFromRequest(request, store.validateUiToken)
      const body = await readJsonBody<AnswerQuestionBody>(request)
      if (typeof body.answer !== 'string') throw new BadRequestError('answer must be a string')

      const workspace = store.getWorkspaceSnapshot(workspaceId)
      answerQuestionInFile(workspace.summary.path, questionId, body.answer)
      sendJson(response, 200, { ok: true })
    }
  ),
  route(
    'POST',
    '/api/workspaces/:workspaceId/cockpit/ideas/:ideaId/promote',
    async ({ params, request, response, store }) => {
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      const ideaId = getRequiredParam(response, params, 'ideaId', 'Idea id is required')
      if (!workspaceId || !ideaId) return

      requireUiTokenFromRequest(request, store.validateUiToken)
      const body = await readJsonBody<PromoteIdeaBody>(request)
      const target = body.target ?? 'question'
      if (target !== 'plan' && target !== 'adr' && target !== 'question') {
        throw new BadRequestError('target must be plan, adr, or question')
      }

      const workspace = store.getWorkspaceSnapshot(workspaceId)
      promoteIdeaInFile(workspace.summary.path, ideaId, target as IdeaPromoteTarget)
      sendJson(response, 200, { ok: true })
    }
  ),
  route(
    'POST',
    '/api/workspaces/:workspaceId/cockpit/decisions/:decisionId/confirm',
    async ({ params, request, response, store }) => {
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      const decisionId = getRequiredParam(response, params, 'decisionId', 'Decision id is required')
      if (!workspaceId || !decisionId) return

      requireUiTokenFromRequest(request, store.validateUiToken)
      await readJsonBody<Record<string, never>>(request)

      const workspace = store.getWorkspaceSnapshot(workspaceId)
      const result = confirmDecisionInFile(workspace.summary.path, decisionId)
      sendJson(response, 200, { ok: true, ...result })
    }
  ),
  route(
    'POST',
    '/api/workspaces/:workspaceId/open-file',
    async ({ params, request, response, store }) => {
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) return

      requireUiTokenFromRequest(request, store.validateUiToken)
      const body = await readJsonBody<OpenFileBody>(request)
      if (typeof body.path !== 'string') throw new BadRequestError('path must be a string')

      const workspace = store.getWorkspaceSnapshot(workspaceId)
      await openWorkspaceFile(workspace.summary.path, body.path)
      sendJson(response, 200, { ok: true })
    }
  ),
]
