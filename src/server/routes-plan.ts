import { parsePlanDoc } from './plan-doc.js'
import { getRequiredParam, route, sendJson } from './route-helpers.js'
import type { RouteDefinition } from './route-types.js'
import { requireUiTokenFromRequest } from './ui-auth-helpers.js'

export const planRoutes: RouteDefinition[] = [
  route(
    'GET',
    '/api/workspaces/:workspaceId/plan',
    ({ params, request, response, store, tasksFileService }) => {
      const workspaceId = getRequiredParam(
        response,
        params,
        'workspaceId',
        'Workspace id is required'
      )
      if (!workspaceId) {
        return
      }

      requireUiTokenFromRequest(request, store.validateUiToken)

      const workspace = store.getWorkspaceSnapshot(workspaceId)
      sendJson(response, 200, parsePlanDoc(tasksFileService.readPlan(workspace.summary.path)))
    }
  ),
]
