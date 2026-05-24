import { parseCockpit } from './cockpit-doc.js'
import { BadRequestError } from './http-errors.js'
import { answerQuestionInFile } from './pm-questions-doc.js'
import { getRequiredParam, readJsonBody, route, sendJson } from './route-helpers.js'
import type { RouteDefinition } from './route-types.js'
import { requireUiTokenFromRequest } from './ui-auth-helpers.js'

interface AnswerQuestionBody {
  answer?: unknown
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
]
